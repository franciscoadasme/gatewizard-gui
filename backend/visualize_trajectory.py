"""Lazy Visualize trajectory access: stride mapping + cached MDAnalysis universe.

Never copies kept frames into a MemoryReader (Analysis does that; Visualize must not).
"""

from __future__ import annotations

import base64
import hashlib
import re
import struct
import threading
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

import MDAnalysis as mda

_SS_STRUCTURE_SUFFIXES = frozenset({".pdb", ".ent", ".cif", ".mmcif"})
_XYZ_CACHE_MAX_FRAMES = 96
_XYZ_BATCH_MAX = 64
_XYZ_BIN_HEADER = struct.Struct("<III")  # atom_count, start_frame, count
GWXY_MAGIC = b"GWXY"
GWXY_VERSION = 1
GWXY_HEADER = struct.Struct("<4sIII")  # magic, version, atom_count, frame_count
GWXY_HEADER_BYTES = 16
ALIGN_MAGIC = b"GWAL"
ALIGN_VERSION = 1
LOAD_ALL_BYTES_CAP = int(4 * 1024 * 1024 * 1024)

_COORDINATE_TRAJECTORY_SUFFIXES = frozenset(
    {".dcd", ".xtc", ".trr", ".nc", ".mdcrd", ".crd", ".dtr", ".lammpstrj", ".h5md"}
)
_TOPOLOGY_ONLY_SUFFIXES = frozenset({".psf", ".prmtop", ".parm7", ".top", ".itp"})
_AMBER_RESTART_SUFFIXES = frozenset({".rst7", ".restrt", ".inpcrd"})

# Shared with app.get-structure: MDA SelectionParser is process-wide.
_TRAJ_SEEK_LOCK = threading.Lock()


def lookup_file_stride(file_strides: dict[str, int] | None, path: Path) -> int:
    """Resolve per-file stride (basename, then case-insensitive). Minimum 1."""
    if not file_strides:
        return 1
    name = path.name
    if name in file_strides:
        return max(1, int(file_strides[name] or 1))
    lower = name.lower()
    for key, value in file_strides.items():
        if str(key).lower() == lower:
            return max(1, int(value or 1))
    return 1


def _is_topology_only(path: Path) -> bool:
    return path.suffix.lower() in _TOPOLOGY_ONLY_SUFFIXES


def _is_amber_restart(path: Path) -> bool:
    return path.suffix.lower() in _AMBER_RESTART_SUFFIXES


def filter_coordinate_trajectories(topology: Path, trajectories: list[Path]) -> list[Path]:
    top_resolved = topology.resolve()
    filtered: list[Path] = []
    for traj in trajectories:
        traj_resolved = traj.resolve()
        if traj_resolved == top_resolved and _is_topology_only(traj):
            continue
        if _is_topology_only(traj) or _is_amber_restart(traj):
            continue
        suffix = traj_resolved.suffix.lower()
        if suffix not in _COORDINATE_TRAJECTORY_SUFFIXES and suffix not in {
            ".pdb",
            ".ent",
            ".gro",
        }:
            continue
        filtered.append(traj)
    return filtered


def load_traj_universe(topology: Path, trajectories: list[Path]) -> mda.Universe:
    coord_trajs = filter_coordinate_trajectories(topology, trajectories)
    if not coord_trajs:
        names = ", ".join(t.name for t in trajectories) or "(none)"
        raise ValueError(
            f"No coordinate trajectory found among: {names}. "
            "Add DCD, XTC, TRR, NC, MDCRD, or a multi-model PDB."
        )
    top_str = str(topology.resolve())
    if len(coord_trajs) == 1:
        return mda.Universe(top_str, str(coord_trajs[0]))
    return mda.Universe(top_str, [str(t) for t in coord_trajs])


def build_logical_map(
    raw_counts: list[int],
    trajectories: list[Path],
    file_strides: dict[str, int] | None,
) -> list[int]:
    """Global raw frame indices (into a concatenated universe) kept after stride."""
    logical: list[int] = []
    offset = 0
    for path, n_raw in zip(trajectories, raw_counts):
        stride = lookup_file_stride(file_strides, path)
        n = max(0, int(n_raw))
        for local_i in range(0, n, stride):
            logical.append(offset + local_i)
        offset += n
    return logical


def per_file_frame_counts(universe: mda.Universe, n_files: int) -> list[int]:
    traj = universe.trajectory
    readers = getattr(traj, "readers", None)
    if readers and len(readers) == n_files:
        return [int(len(r)) for r in readers]
    if n_files == 1:
        return [int(len(traj))]
    return [int(len(traj))]


def _traj_cache_key(topology: Path, trajectories: list[Path], mtimes: tuple[float, ...]) -> str:
    parts = [str(topology.resolve()), *(str(p.resolve()) for p in trajectories)]
    stamp = ",".join(f"{t:.6f}" for t in mtimes)
    return "|".join(parts) + f"|mt:{stamp}"


def ss_assignment_source_path(*candidates: str | Path | None) -> str | None:
    """Return the first PDB/mmCIF path usable for secondary-structure assignment.

    Coordinate-only files (DCD/XTC) exist on disk but are not SS sources — callers
    should write a temp PDB from the current universe when this returns None.
    """
    for raw in candidates:
        if not raw:
            continue
        path = Path(raw)
        if path.is_file() and path.suffix.lower() in _SS_STRUCTURE_SUFFIXES:
            return str(path)
    return None


@dataclass
class TrajSession:
    topology: Path
    trajectories: list[Path]
    file_strides: dict[str, int]
    universe: mda.Universe
    raw_counts: list[int]
    logical_raw: list[int]
    mtimes: tuple[float, ...]
    xyz_bytes: dict[int, bytes] = field(default_factory=dict)
    xyz_lru: list[int] = field(default_factory=list)

    @property
    def logical_frame_count(self) -> int:
        return len(self.logical_raw)

    def raw_index(self, logical_frame: int) -> int:
        n = self.logical_frame_count
        if n <= 0:
            raise ValueError("Trajectory has no frames after stride")
        i = int(logical_frame)
        if i < 0 or i >= n:
            raise ValueError(f"Frame {i} out of range 0…{n - 1}")
        return self.logical_raw[i]


_TRAJ_CACHE: dict[str, TrajSession] = {}
_TRAJ_CACHE_LOCK = threading.Lock()
_SIDECAR_LOCK = threading.Lock()
_SIDECARS: dict[str, "SidecarJob"] = {}


def host_visible_path(path: Path | str) -> str:
    """Translate WSL ``/mnt/c/...`` to a Windows path Electron can open."""
    raw = str(path)
    norm = raw.replace("\\", "/")
    match = re.match(r"^/mnt/([A-Za-z])/(.*)$", norm)
    if match:
        return f"{match.group(1).upper()}:\\{match.group(2).replace('/', '\\')}"
    return raw


def load_all_fits(atom_count: int, frame_count: int, cap: int = LOAD_ALL_BYTES_CAP) -> bool:
    return int(atom_count) * int(frame_count) * 12 <= int(cap)


def sidecar_identity(session: TrajSession) -> str:
    strides = ",".join(
        f"{key}={session.file_strides.get(key, 1)}" for key in sorted(session.file_strides)
    )
    parts = [
        str(session.topology.resolve()),
        *(str(p.resolve()) for p in session.trajectories),
        ",".join(f"{t:.6f}" for t in session.mtimes),
        strides,
        str(session.logical_frame_count),
        str(int(session.universe.atoms.n_atoms)),
    ]
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:20]


def resolve_sidecar_dir(cache_dir: str | None, session: TrajSession) -> Path:
    root = Path(cache_dir).expanduser() if cache_dir else session.trajectories[0].parent
    out = root / ".gatewizard" / "traj_cache"
    out.mkdir(parents=True, exist_ok=True)
    return out


@dataclass
class SidecarJob:
    path: Path
    atom_count: int
    frames_total: int
    frames_ready: int = 0
    complete: bool = False
    error: str | None = None
    lock: threading.Lock = field(default_factory=threading.Lock)
    thread: threading.Thread | None = None


def sidecar_status_payload(job: SidecarJob) -> dict:
    data_bytes = int(job.frames_total) * int(job.atom_count) * 12
    readable = job.path if job.complete else job.path.with_suffix(".gwxyz.part")
    if not readable.is_file() and job.path.is_file():
        readable = job.path
    return {
        "path": str(readable),
        "host_path": host_visible_path(readable),
        "bytes": data_bytes,
        "header_bytes": GWXY_HEADER_BYTES,
        "frames_ready": int(job.frames_ready),
        "frames_total": int(job.frames_total),
        "atom_count": int(job.atom_count),
        "complete": bool(job.complete),
        "error": job.error,
        "load_all": load_all_fits(job.atom_count, job.frames_total),
        "load_all_bytes_cap": LOAD_ALL_BYTES_CAP,
    }


def _read_gwxy_header(path: Path) -> tuple[int, int] | None:
    if not path.is_file() or path.stat().st_size < GWXY_HEADER_BYTES:
        return None
    with path.open("rb") as handle:
        raw = handle.read(GWXY_HEADER_BYTES)
    if len(raw) < GWXY_HEADER_BYTES:
        return None
    magic, version, atom_count, frame_count = GWXY_HEADER.unpack(raw)
    if magic != GWXY_MAGIC or int(version) != GWXY_VERSION:
        return None
    return int(atom_count), int(frame_count)


def _open_complete_sidecar(path: Path, atom_count: int, frames_total: int) -> SidecarJob | None:
    header = _read_gwxy_header(path)
    if header is None:
        return None
    n_at, n_fr = header
    if n_at != atom_count or n_fr != frames_total:
        return None
    expect = GWXY_HEADER_BYTES + frames_total * atom_count * 12
    if path.stat().st_size < expect:
        return None
    return SidecarJob(
        path=path,
        atom_count=atom_count,
        frames_total=frames_total,
        frames_ready=frames_total,
        complete=True,
    )


def _extract_sidecar(session: TrajSession, job: SidecarJob) -> None:
    tmp = job.path.with_suffix(".gwxyz.part")
    try:
        n_at = job.atom_count
        n_fr = job.frames_total
        wanted = {int(session.raw_index(i)): i for i in range(n_fr)}
        with tmp.open("wb") as handle:
            handle.write(GWXY_HEADER.pack(GWXY_MAGIC, GWXY_VERSION, n_at, n_fr))
            written = 0
            with _TRAJ_SEEK_LOCK:
                universe = session.universe
                for ts in universe.trajectory:
                    logical = wanted.get(int(ts.frame))
                    if logical is None:
                        continue
                    blob = np.ascontiguousarray(universe.atoms.positions, dtype=np.float32).tobytes()
                    if len(blob) != n_at * 12:
                        raise ValueError("Atom count changed while extracting trajectory")
                    handle.write(blob)
                    written += 1
                    with job.lock:
                        job.frames_ready = written
                    if written >= n_fr:
                        break
            handle.flush()
        if written != n_fr:
            raise ValueError(f"Extracted {written} of {n_fr} logical frames")
        tmp.replace(job.path)
        with job.lock:
            job.complete = True
            job.frames_ready = n_fr
            job.error = None
    except Exception as exc:
        with job.lock:
            job.error = str(exc)
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass


def sidecar_job_for(session: TrajSession) -> SidecarJob | None:
    return _SIDECARS.get(sidecar_identity(session))


def ensure_traj_sidecar(
    session: TrajSession,
    cache_dir: str | None = None,
    start: bool = True,
) -> dict:
    ident = sidecar_identity(session)
    n_at = int(session.universe.atoms.n_atoms)
    n_fr = session.logical_frame_count
    dest = resolve_sidecar_dir(cache_dir, session) / f"{ident}.gwxyz"
    with _SIDECAR_LOCK:
        job = _SIDECARS.get(ident)
        if job is not None and job.error:
            _SIDECARS.pop(ident, None)
            job = None
        if job is not None:
            return sidecar_status_payload(job)
        existing = _open_complete_sidecar(dest, n_at, n_fr)
        if existing is not None:
            _SIDECARS[ident] = existing
            return sidecar_status_payload(existing)
        job = SidecarJob(path=dest, atom_count=n_at, frames_total=n_fr)
        _SIDECARS[ident] = job
        if start and n_fr > 0:
            thread = threading.Thread(
                target=_extract_sidecar, args=(session, job), daemon=True, name=f"gwxyz-{ident}"
            )
            job.thread = thread
            thread.start()
        elif n_fr <= 0:
            job.complete = True
        return sidecar_status_payload(job)


def wait_traj_sidecar(
    session: TrajSession,
    cache_dir: str | None = None,
    timeout: float | None = None,
) -> SidecarJob:
    ensure_traj_sidecar(session, cache_dir, start=True)
    job = sidecar_job_for(session)
    if job is None:
        raise ValueError("Could not start trajectory cache")
    thread = job.thread
    if thread is not None and thread.is_alive():
        thread.join(timeout)
    if job.error:
        raise ValueError(job.error)
    if not job.complete:
        raise ValueError("Trajectory cache is still building")
    return job


def read_sidecar_frame_bytes(job: SidecarJob, logical_frame: int) -> bytes | None:
    frame = int(logical_frame)
    with job.lock:
        ready = int(job.frames_ready)
        path = job.path if job.complete else job.path.with_suffix(".gwxyz.part")
    if frame < 0 or frame >= ready:
        return None
    size = job.atom_count * 12
    offset = GWXY_HEADER_BYTES + frame * size
    read_path = job.path if job.complete or job.path.is_file() else path
    if not read_path.is_file():
        read_path = path
    if not read_path.is_file():
        return None
    with read_path.open("rb") as handle:
        handle.seek(offset)
        blob = handle.read(size)
    if len(blob) != size:
        return None
    return blob


def _stat_mtimes(topology: Path, trajectories: list[Path]) -> tuple[float, ...]:
    return (float(topology.stat().st_mtime), *(float(p.stat().st_mtime) for p in trajectories))


def open_traj_session(
    topology_path: str,
    trajectory_paths: list[str],
    file_strides: dict[str, int] | None = None,
) -> TrajSession:
    topology = Path(topology_path).expanduser().resolve()
    if not topology.is_file():
        raise FileNotFoundError(f"Topology not found: {topology}")
    raw_trajs = [Path(p).expanduser().resolve() for p in trajectory_paths]
    for t in raw_trajs:
        if not t.is_file():
            raise FileNotFoundError(f"Trajectory not found: {t}")
    coord_trajs = filter_coordinate_trajectories(topology, raw_trajs)
    if not coord_trajs:
        raise ValueError(
            "No coordinate trajectory found. Add DCD, XTC, TRR, NC, MDCRD, or a multi-model PDB."
        )
    strides = {str(k): max(1, int(v or 1)) for k, v in (file_strides or {}).items()}
    mtimes = _stat_mtimes(topology, coord_trajs)
    key = _traj_cache_key(topology, coord_trajs, mtimes)
    with _TRAJ_CACHE_LOCK:
        hit = _TRAJ_CACHE.get(key)
        if hit is not None:
            if hit.file_strides != strides:
                hit.xyz_bytes.clear()
                hit.xyz_lru.clear()
            hit.file_strides = strides
            hit.logical_raw = build_logical_map(hit.raw_counts, hit.trajectories, strides)
            return hit
        universe = load_traj_universe(topology, coord_trajs)
        raw_counts = per_file_frame_counts(universe, len(coord_trajs))
        if sum(raw_counts) != int(len(universe.trajectory)) and len(coord_trajs) > 1:
            raw_counts = [int(len(universe.trajectory))]
            coord_trajs = [coord_trajs[0]]
        session = TrajSession(
            topology=topology,
            trajectories=coord_trajs,
            file_strides=strides,
            universe=universe,
            raw_counts=raw_counts,
            logical_raw=build_logical_map(raw_counts, coord_trajs, strides),
            mtimes=mtimes,
        )
        _TRAJ_CACHE[key] = session
        return session


def box_lengths_from_dimensions(dimensions) -> list[float] | None:
    """Orthorhombic edge lengths (Å) from MDA ``ts.dimensions``, or None."""
    if dimensions is None:
        return None
    try:
        arr = np.asarray(dimensions, dtype=np.float64).reshape(-1)
    except (TypeError, ValueError):
        return None
    if arr.size < 3:
        return None
    lx, ly, lz = float(arr[0]), float(arr[1]), float(arr[2])
    if not (np.isfinite(lx) and np.isfinite(ly) and np.isfinite(lz)):
        return None
    if lx <= 1e-3 or ly <= 1e-3 or lz <= 1e-3:
        return None
    return [lx, ly, lz]


def trajectory_box_lengths(session: TrajSession) -> list[float] | None:
    dimensions = None
    try:
        dimensions = session.universe.trajectory.ts.dimensions
    except Exception:
        dimensions = None
    if dimensions is None:
        try:
            dimensions = session.universe.dimensions
        except Exception:
            dimensions = None
    box = box_lengths_from_dimensions(dimensions)
    if box is not None:
        return box
    if session.logical_frame_count <= 0:
        return None
    try:
        seek_logical_frame(session, 0)
        return box_lengths_from_dimensions(session.universe.trajectory.ts.dimensions)
    except Exception:
        return None


def trajectory_info_payload(session: TrajSession) -> dict:
    dt = None
    try:
        raw_dt = float(getattr(session.universe.trajectory, "dt", 0) or 0)
        if raw_dt > 0:
            dt = raw_dt
    except Exception:
        dt = None
    files = []
    for path, n_raw in zip(session.trajectories, session.raw_counts):
        stride = lookup_file_stride(session.file_strides, path)
        kept = len(range(0, int(n_raw), stride)) if n_raw > 0 else 0
        files.append(
            {
                "path": str(path),
                "name": path.name,
                "n_frames": int(n_raw),
                "stride": stride,
                "n_logical": kept,
            }
        )
    return {
        "topology": str(session.topology),
        "atom_count": int(session.universe.atoms.n_atoms),
        "logical_frame_count": session.logical_frame_count,
        "raw_frame_count": int(sum(session.raw_counts)),
        "dt_ps": dt,
        "box": trajectory_box_lengths(session),
        "files": files,
    }


def seek_logical_frame(session: TrajSession, logical_frame: int) -> None:
    raw = session.raw_index(logical_frame)
    with _TRAJ_SEEK_LOCK:
        session.universe.trajectory[raw]


def _remember_xyz_bytes(session: TrajSession, logical_frame: int, blob: bytes) -> None:
    session.xyz_bytes[logical_frame] = blob
    if logical_frame in session.xyz_lru:
        session.xyz_lru.remove(logical_frame)
    session.xyz_lru.append(logical_frame)
    while len(session.xyz_lru) > _XYZ_CACHE_MAX_FRAMES:
        drop = session.xyz_lru.pop(0)
        session.xyz_bytes.pop(drop, None)


def xyz_bytes_for_frame(session: TrajSession, logical_frame: int) -> bytes:
    hit = session.xyz_bytes.get(int(logical_frame))
    if hit is not None:
        if logical_frame in session.xyz_lru:
            session.xyz_lru.remove(logical_frame)
            session.xyz_lru.append(logical_frame)
        return hit
    job = sidecar_job_for(session)
    if job is not None:
        blob = read_sidecar_frame_bytes(job, logical_frame)
        if blob is not None:
            _remember_xyz_bytes(session, int(logical_frame), blob)
            return blob
    seek_logical_frame(session, logical_frame)
    blob = np.ascontiguousarray(session.universe.atoms.positions, dtype=np.float32).tobytes()
    _remember_xyz_bytes(session, int(logical_frame), blob)
    return blob


def frame_xyz_columnar(session: TrajSession, logical_frame: int) -> dict:
    blob = xyz_bytes_for_frame(session, logical_frame)
    pos = np.frombuffer(blob, dtype=np.float32).reshape((-1, 3))
    return {
        "frame": int(logical_frame),
        "raw_frame": int(session.raw_index(logical_frame)),
        "atom_count": int(pos.shape[0]),
        "atoms_format": "xyz",
        "x": pos[:, 0].tolist(),
        "y": pos[:, 1].tolist(),
        "z": pos[:, 2].tolist(),
    }


def frame_xyz_packed(session: TrajSession, logical_frame: int, count: int = 1) -> dict:
    """One or more logical frames as little-endian float32 xyz (base64)."""
    n_logical = session.logical_frame_count
    start = int(logical_frame)
    want = max(1, min(_XYZ_BATCH_MAX, int(count or 1)))
    blobs: list[bytes] = []
    atom_count = 0
    for i in range(want):
        frame = start + i
        if frame < 0 or frame >= n_logical:
            break
        blob = xyz_bytes_for_frame(session, frame)
        if not atom_count:
            atom_count = len(blob) // 12
        blobs.append(blob)
    packed = b"".join(blobs)
    return {
        "frame": start,
        "count": len(blobs),
        "raw_frame": int(session.raw_index(start)) if blobs else start,
        "atom_count": int(atom_count),
        "atoms_format": "xyz_f32",
        "xyz_b64": base64.b64encode(packed).decode("ascii"),
    }


def frame_xyz_binary(session: TrajSession, logical_frame: int, count: int = 1) -> bytes:
    """Little-endian header + packed float32 xyz. Avoids JSON/base64 on the play path."""
    n_logical = session.logical_frame_count
    start = int(logical_frame)
    want = max(1, min(_XYZ_BATCH_MAX, int(count or 1)))
    blobs: list[bytes] = []
    atom_count = 0
    for i in range(want):
        frame = start + i
        if frame < 0 or frame >= n_logical:
            break
        blob = xyz_bytes_for_frame(session, frame)
        if not atom_count:
            atom_count = len(blob) // 12
        blobs.append(blob)
    return _XYZ_BIN_HEADER.pack(int(atom_count), start, len(blobs)) + b"".join(blobs)


def kabsch_rotation(mobile_centered: np.ndarray, ref_centered: np.ndarray) -> tuple[np.ndarray, float]:
    """Rotate ``mobile`` onto ``ref`` (both centered). ``x' = x @ R``.

    Same superposition as MDAnalysis ``rms.rmsd(..., superposition=True)`` /
    Analysis RMSD with Align on. ``R = U @ Vt`` (not ``Vt.T @ U.T``).
    """
    cov = mobile_centered.T @ ref_centered
    u_mat, _s, vt = np.linalg.svd(cov)
    if np.linalg.det(u_mat) * np.linalg.det(vt) < 0.0:
        vt = np.array(vt, copy=True)
        vt[-1] *= -1
    rot = u_mat @ vt
    aligned = mobile_centered @ rot
    rmsd = float(np.sqrt(np.mean(np.sum((aligned - ref_centered) ** 2, axis=1))))
    return rot, rmsd


def pack_align_result(result: dict) -> bytes:
    """Binary GWAL: header + utf-8 selection + float64 rmsd + float32 affines."""
    sel = str(result["selection"]).encode("utf-8")
    n_frames = int(result["n_frames"])
    header = struct.pack(
        "<4sIIII",
        ALIGN_MAGIC,
        ALIGN_VERSION,
        n_frames,
        int(result["n_mobile"]),
        int(result["reference_frame"]),
    )
    header += struct.pack("<I", len(sel)) + sel
    pad = (8 - (len(header) % 8)) % 8
    header += b"\x00" * pad
    rmsd = np.asarray(result["rmsd"], dtype=np.float64).reshape(n_frames)
    affines = np.asarray(result["affines"], dtype=np.float32).reshape(n_frames * 12)
    return header + rmsd.tobytes() + affines.tobytes()


def unpack_align_result(blob: bytes) -> dict:
    magic, version, n_frames, n_mobile, ref_frame = struct.unpack_from("<4sIIII", blob, 0)
    if magic != ALIGN_MAGIC or int(version) != ALIGN_VERSION:
        raise ValueError("Not a GWAL alignment payload")
    sel_len = struct.unpack_from("<I", blob, 20)[0]
    sel = blob[24 : 24 + sel_len].decode("utf-8")
    header_len = 24 + sel_len
    header_len += (8 - (header_len % 8)) % 8
    rmsd = np.frombuffer(blob, dtype=np.float64, count=n_frames, offset=header_len)
    aff_off = header_len + n_frames * 8
    affines = np.frombuffer(blob, dtype=np.float32, count=n_frames * 12, offset=aff_off)
    return {
        "selection": sel,
        "reference_frame": int(ref_frame),
        "n_mobile": int(n_mobile),
        "n_frames": int(n_frames),
        "rmsd": rmsd.tolist(),
        "affines": affines.tolist(),
        "x_label": "Frame",
        "y_label": "RMSD (Å)",
        "series_name": f"RMSD ({sel})",
    }


def compute_traj_alignment(
    session: TrajSession,
    selection: str,
    reference_frame: int = 0,
    cache_dir: str | None = None,
    align: bool = True,
) -> dict:
    """RMSD versus a reference frame from the packed sidecar.

    ``align=True`` Kabsch-fits the selection each frame and returns per-frame
    affines (apply ``x @ R + t`` to *all* atoms). ``align=False`` is raw RMSD
    of the selection coordinates — no rotation/translation.
    """
    sel = (selection or "").strip() or "protein and backbone"
    universe = session.universe
    try:
        mobile = universe.select_atoms(sel)
    except Exception as exc:
        raise ValueError(f"Invalid alignment selection {sel!r}: {exc}") from exc
    do_align = bool(align)
    min_atoms = 3 if do_align else 1
    if mobile.n_atoms < min_atoms:
        need = "at least 3" if do_align else "at least 1"
        raise ValueError(
            f"{'Alignment' if do_align else 'RMSD'} selection {sel!r} matched "
            f"{mobile.n_atoms} atom(s); need {need}."
        )

    n = session.logical_frame_count
    if n <= 0:
        raise ValueError("Trajectory has no frames after stride")
    ref_i = int(reference_frame)
    if ref_i < 0 or ref_i >= n:
        raise ValueError(f"Reference frame {ref_i} out of range 0…{n - 1}")

    job = wait_traj_sidecar(session, cache_dir)
    n_at = job.atom_count
    mapped = np.memmap(
        job.path,
        dtype=np.float32,
        mode="r",
        offset=GWXY_HEADER_BYTES,
        shape=(n, n_at, 3),
    )
    indices = np.asarray(mobile.indices, dtype=np.int64)
    ref = np.asarray(mapped[ref_i, indices], dtype=np.float64)
    ref_com = ref.mean(axis=0)
    ref_centered = ref - ref_com
    rmsd = np.zeros(n, dtype=np.float64)
    affines = np.zeros((n, 12), dtype=np.float32)
    ident = np.array([1, 0, 0, 0, 1, 0, 0, 0, 1], dtype=np.float32)
    for i in range(n):
        pos = np.asarray(mapped[i, indices], dtype=np.float64)
        if do_align:
            com = pos.mean(axis=0)
            rot, rms = kabsch_rotation(pos - com, ref_centered)
            t = ref_com - com @ rot
            affines[i, :9] = rot.ravel()
            affines[i, 9:] = t
            rmsd[i] = rms
        else:
            diff = pos - ref
            rmsd[i] = float(np.sqrt(np.mean(np.sum(diff * diff, axis=1))))
            affines[i, :9] = ident
    del mapped

    return {
        "selection": sel,
        "reference_frame": ref_i,
        "n_mobile": int(mobile.n_atoms),
        "n_frames": n,
        "aligned": do_align,
        "rmsd": rmsd.tolist(),
        "affines": affines.ravel().tolist(),
        "x_label": "Frame",
        "y_label": "RMSD (Å)",
        "series_name": f"{'Aligned' if do_align else 'Unaligned'} RMSD ({sel})",
    }
