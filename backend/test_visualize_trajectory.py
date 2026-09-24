"""Stride mapping and lazy frame seek for Visualize trajectories."""

from pathlib import Path

import base64
import struct

import numpy as np
from MDAnalysis.analysis.rms import rmsd as mda_rmsd

from visualize_trajectory import (
    GWXY_HEADER_BYTES,
    box_lengths_from_dimensions,
    build_logical_map,
    compute_traj_alignment,
    ensure_traj_sidecar,
    frame_xyz_binary,
    frame_xyz_columnar,
    frame_xyz_packed,
    host_visible_path,
    kabsch_rotation,
    load_all_fits,
    lookup_file_stride,
    open_traj_session,
    pack_align_result,
    ss_assignment_source_path,
    trajectory_info_payload,
    unpack_align_result,
    wait_traj_sidecar,
)


def test_lookup_file_stride_basename_and_case():
    p = Path("/tmp/run.xtc")
    assert lookup_file_stride(None, p) == 1
    assert lookup_file_stride({"run.xtc": 3}, p) == 3
    assert lookup_file_stride({"RUN.XTC": 4}, p) == 4
    assert lookup_file_stride({"other.xtc": 2}, p) == 1


def test_build_logical_map_two_files_mixed_stride():
    a = Path("a.xtc")
    b = Path("b.xtc")
    # 5 + 6 raw frames, strides 2 and 3 → logical raw indices
    # a: 0,2,4  (offset 0)
    # b: 0,3    (offset 5) → 5, 8
    logical = build_logical_map([5, 6], [a, b], {"a.xtc": 2, "b.xtc": 3})
    assert logical == [0, 2, 4, 5, 8]


def _write_multimodel_pdb(path: Path, n_models: int) -> None:
    lines = []
    for m in range(n_models):
        x = float(m)
        lines.append(f"MODEL     {m + 1:4d}\n")
        lines.append(
            f"ATOM      1  N   MET A   1     {x:7.3f}   0.000   0.000  1.00  0.00           N\n"
        )
        lines.append(
            f"ATOM      2  CA  MET A   1     {x + 1:7.3f}   0.000   0.000  1.00  0.00           C\n"
        )
        lines.append("ENDMDL\n")
    lines.append("END\n")
    path.write_text("".join(lines), encoding="utf-8")


def test_open_session_stride_and_xyz(tmp_path: Path):
    pdb = tmp_path / "traj.pdb"
    _write_multimodel_pdb(pdb, 6)
    session = open_traj_session(str(pdb), [str(pdb)], {pdb.name: 2})
    info = trajectory_info_payload(session)
    assert info["atom_count"] == 2
    assert info["logical_frame_count"] == 3
    assert info["files"][0]["n_frames"] == 6
    assert info["files"][0]["n_logical"] == 3

    f0 = frame_xyz_columnar(session, 0)
    f1 = frame_xyz_columnar(session, 1)
    f2 = frame_xyz_columnar(session, 2)
    assert f0["atom_count"] == 2
    assert abs(f0["x"][0] - 0.0) < 1e-3
    # stride 2 → raw frames 0, 2, 4 → N atom x = 0, 2, 4
    assert abs(f1["x"][0] - 2.0) < 1e-3
    assert abs(f2["x"][0] - 4.0) < 1e-3
    assert len(f0["x"]) == len(f0["y"]) == len(f0["z"])
    assert info.get("box") is None


def test_box_lengths_from_dimensions():
    assert box_lengths_from_dimensions(None) is None
    assert box_lengths_from_dimensions([0, 0, 0, 90, 90, 90]) is None
    got = box_lengths_from_dimensions([80.0, 81.5, 90.0, 90.0, 90.0, 90.0])
    assert got is not None
    assert abs(got[0] - 80.0) < 1e-9
    assert abs(got[1] - 81.5) < 1e-9
    assert abs(got[2] - 90.0) < 1e-9


def _write_pbc_pdb(path: Path) -> None:
    path.write_text(
        "CRYST1   20.000   20.000   20.000  90.00  90.00  90.00 P 1           1\n"
        "MODEL        1\n"
        "ATOM      1  NA  NA  X   1       1.000   0.000   0.000  1.00  0.00          NA\n"
        "ENDMDL\n"
        "END\n",
        encoding="utf-8",
    )


def test_trajectory_info_box_from_cryst1(tmp_path: Path):
    pdb = tmp_path / "ion.pdb"
    _write_pbc_pdb(pdb)
    session = open_traj_session(str(pdb), [str(pdb)], None)
    info = trajectory_info_payload(session)
    assert info["box"] is not None
    assert abs(info["box"][0] - 20.0) < 0.2
    assert abs(info["box"][1] - 20.0) < 0.2
    assert abs(info["box"][2] - 20.0) < 0.2


def test_frame_out_of_range(tmp_path: Path):
    pdb = tmp_path / "traj.pdb"
    _write_multimodel_pdb(pdb, 3)
    session = open_traj_session(str(pdb), [str(pdb)], None)
    try:
        frame_xyz_columnar(session, 9)
        raise AssertionError("expected ValueError")
    except ValueError as ex:
        assert "out of range" in str(ex)


def test_ss_assignment_source_path_ignores_dcd(tmp_path: Path):
    dcd = tmp_path / "run.dcd"
    dcd.write_bytes(b"not-a-real-dcd")
    pdb = tmp_path / "prot.pdb"
    pdb.write_text("END\n", encoding="utf-8")
    assert ss_assignment_source_path(str(dcd)) is None
    assert ss_assignment_source_path(str(dcd), str(pdb)) == str(pdb)


def test_packed_xyz_batch(tmp_path: Path):
    pdb = tmp_path / "traj.pdb"
    _write_multimodel_pdb(pdb, 4)
    session = open_traj_session(str(pdb), [str(pdb)], None)
    packed = frame_xyz_packed(session, 1, count=2)
    assert packed["atoms_format"] == "xyz_f32"
    assert packed["count"] == 2
    assert packed["atom_count"] == 2
    raw = np.frombuffer(base64.b64decode(packed["xyz_b64"]), dtype=np.float32)
    assert raw.size == 2 * 2 * 3
    # frame 1 N atom x = 1.0
    assert abs(float(raw[0]) - 1.0) < 1e-3


def test_frame_xyz_binary_header(tmp_path: Path):
    pdb = tmp_path / "traj.pdb"
    _write_multimodel_pdb(pdb, 3)
    session = open_traj_session(str(pdb), [str(pdb)], None)
    blob = frame_xyz_binary(session, 0, count=2)
    atom_count, start, count = struct.unpack_from("<III", blob, 0)
    assert atom_count == 2
    assert start == 0
    assert count == 2
    raw = np.frombuffer(blob, dtype=np.float32, offset=12)
    assert raw.size == 2 * 2 * 3
    assert abs(float(raw[0]) - 0.0) < 1e-3


def _write_align_pdb(path: Path) -> None:
    def atom(serial: int, name: str, x: float, y: float, z: float, elem: str) -> str:
        return (
            f"ATOM  {serial:5d}  {name:<3s} MET A   1    "
            f"{x:8.3f}{y:8.3f}{z:8.3f}  1.00  0.00           {elem}\n"
        )

    lines = ["MODEL        1\n"]
    lines.append(atom(1, "N", 0.0, 0.0, 0.0, "N"))
    lines.append(atom(2, "CA", 1.5, 0.0, 0.0, "C"))
    lines.append(atom(3, "C", 2.0, 1.4, 0.0, "C"))
    lines.append(atom(4, "O", 3.2, 1.5, 0.0, "O"))
    lines.append("ENDMDL\nMODEL        2\n")
    lines.append(atom(1, "N", 5.0, 0.0, 0.0, "N"))
    lines.append(atom(2, "CA", 6.5, 0.0, 0.0, "C"))
    lines.append(atom(3, "C", 7.0, 1.4, 0.0, "C"))
    lines.append(atom(4, "O", 8.2, 1.5, 0.0, "O"))
    lines.append("ENDMDL\nEND\n")
    path.write_text("".join(lines), encoding="utf-8")


def test_compute_traj_alignment_translation(tmp_path: Path):
    pdb = tmp_path / "fit.pdb"
    _write_align_pdb(pdb)
    session = open_traj_session(str(pdb), [str(pdb)], None)
    result = compute_traj_alignment(session, "protein and backbone", 0, cache_dir=str(tmp_path))
    assert result["n_mobile"] >= 3
    assert result["n_frames"] == 2
    assert result["rmsd"][0] < 1e-4
    assert result["rmsd"][1] < 1e-3
    aff = np.array(result["affines"], dtype=np.float64).reshape((2, 12))
    r = aff[1, :9].reshape(3, 3)
    t = aff[1, 9:]
    moved = np.array([5.0, 0.0, 0.0]) @ r + t
    assert abs(moved[0]) < 1e-2
    assert abs(moved[1]) < 1e-2
    assert abs(moved[2]) < 1e-2
    packed = pack_align_result(result)
    again = unpack_align_result(packed)
    assert again["n_frames"] == 2
    assert again["selection"] == "protein and backbone"
    assert abs(again["rmsd"][0] - result["rmsd"][0]) < 1e-9
    assert result["aligned"] is True


def test_kabsch_rotation_matches_mda_superpose():
    rng = np.random.default_rng(0)
    ref = rng.normal(size=(48, 3))
    angle = 1.1
    c, s = np.cos(angle), np.sin(angle)
    rot_z = np.array([[c, s, 0.0], [-s, c, 0.0], [0.0, 0.0, 1.0]])
    mobile = ref @ rot_z + np.array([4.0, -2.0, 3.0]) + rng.normal(scale=0.04, size=ref.shape)
    rc = ref - ref.mean(axis=0)
    mc = mobile - mobile.mean(axis=0)
    rot, rms = kabsch_rotation(mc, rc)
    expect = float(mda_rmsd(mobile, ref, superposition=True, center=True))
    assert abs(rms - expect) < 1e-8
    assert rms < 0.2
    aligned = mc @ rot
    assert float(np.sqrt(np.mean(np.sum((aligned - rc) ** 2, axis=1)))) == rms


def test_compute_traj_rmsd_unaligned_no_affines_needed(tmp_path: Path):
    pdb = tmp_path / "fit.pdb"
    _write_align_pdb(pdb)
    session = open_traj_session(str(pdb), [str(pdb)], None)
    raw = compute_traj_alignment(
        session, "protein and backbone", 0, cache_dir=str(tmp_path), align=False
    )
    assert raw["aligned"] is False
    assert raw["rmsd"][0] < 1e-4
    assert raw["rmsd"][1] > 4.0
    fitted = compute_traj_alignment(
        session, "all", 0, cache_dir=str(tmp_path), align=True
    )
    assert fitted["aligned"] is True
    assert fitted["rmsd"][1] < 1e-3
    aff = np.array(fitted["affines"], dtype=np.float64).reshape((2, 12))
    extra = np.array([5.0, 1.0, 2.0])
    r = aff[1, :9].reshape(3, 3)
    t = aff[1, 9:]
    moved = extra @ r + t
    assert abs(moved[0] - 0.0) < 1e-2
    assert abs(moved[1] - 1.0) < 1e-2
    assert abs(moved[2] - 2.0) < 1e-2


def test_sidecar_extract_and_cache_hit(tmp_path: Path):
    pdb = tmp_path / "traj.pdb"
    _write_multimodel_pdb(pdb, 5)
    session = open_traj_session(str(pdb), [str(pdb)], {pdb.name: 2})
    first = ensure_traj_sidecar(session, str(tmp_path), start=True)
    job = wait_traj_sidecar(session, str(tmp_path))
    assert job.complete
    assert job.frames_ready == 3
    expect = GWXY_HEADER_BYTES + 3 * 2 * 12
    assert job.path.stat().st_size == expect
    second = ensure_traj_sidecar(session, str(tmp_path), start=True)
    assert second["complete"] is True
    assert second["frames_total"] == 3
    assert first["atom_count"] == 2
    xyz = frame_xyz_binary(session, 1, count=1)
    raw = np.frombuffer(xyz, dtype=np.float32, offset=12)
    assert abs(float(raw[0]) - 2.0) < 1e-3


def test_load_all_fits_gate():
    assert load_all_fits(10, 10)
    # 200k atoms * 1000 frames * 12 B is about 2.2 GiB, under the 4 GiB cap.
    assert load_all_fits(200_000, 1_000)
    assert not load_all_fits(200_000, 20_000)


def test_host_visible_path_wsl():
    assert host_visible_path("/mnt/c/Users/me/a.gwxyz") == r"C:\Users\me\a.gwxyz"


def test_load_structure_dcd_has_frame0_coords(tmp_path: Path):
    import MDAnalysis as mda

    from app import get_atoms_columnar, load_structure

    pdb = tmp_path / "top.pdb"
    _write_multimodel_pdb(pdb, 4)
    src = mda.Universe(str(pdb))
    dcd = tmp_path / "run.dcd"
    with mda.Writer(str(dcd), n_atoms=src.atoms.n_atoms) as writer:
        for _ts in src.trajectory:
            writer.write(src.atoms)

    universe, topology_used, _bond = load_structure(dcd, topology=str(pdb))
    pos = np.asarray(universe.atoms.positions, dtype=np.float64)
    assert pos.shape == (2, 3)
    assert abs(float(pos[0, 0]) - 0.0) < 1e-3
    assert int(universe.trajectory.n_frames) == 1
    assert Path(topology_used).resolve() == pdb.resolve()
    atoms = get_atoms_columnar(universe.atoms)
    assert len(atoms["x"]) == 2
