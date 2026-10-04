"""Assembly mmCIF keeps numbered chain ids through the viewer loader."""

from pathlib import Path

import MDAnalysis as mda

from app import (
    DetectMoleculesRequest,
    EditSavePdbRequest,
    StructureRequest,
    detect_molecules,
    edit_save_pdb,
    get_structure,
)
from gatewizard.core.assembly import build_assembly

_DIMER = """\
REMARK 350 BIOMOLECULE: 1
REMARK 350 AUTHOR DETERMINED BIOLOGICAL UNIT: DIMERIC
REMARK 350 APPLY THE FOLLOWING TO CHAINS: A
REMARK 350   BIOMT1   1  1.000000  0.000000  0.000000        0.00000
REMARK 350   BIOMT2   1  0.000000  1.000000  0.000000        0.00000
REMARK 350   BIOMT3   1  0.000000  0.000000  1.000000        0.00000
REMARK 350   BIOMT1   2 -1.000000  0.000000  0.000000        0.00000
REMARK 350   BIOMT2   2  0.000000 -1.000000  0.000000        0.00000
REMARK 350   BIOMT3   2  0.000000  0.000000  1.000000        0.00000
ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00  0.00           N
ATOM      2  CA  ALA A   1       1.000   0.000   0.000  1.00  0.00           C
END
"""


def test_get_structure_keeps_assembly_chain_names(tmp_path: Path) -> None:
    pdb_path = tmp_path / "dimer.pdb"
    pdb_path.write_text(_DIMER, encoding="utf-8")
    built = build_assembly(pdb_path, "1")
    data = get_structure(
        StructureRequest(
            path=built["path"],
            needs_bonds=False,
            needs_secondary_structure=True,
        )
    )
    assert set(data["atoms"]["chain_id"]) == {"A1", "A2"}
    assert data["residues"]
    assert {residue["chain"] for residue in data["residues"]} == {"A1", "A2"}
    by_chain: dict[str, dict[int, str | None]] = {}
    for residue in data["residues"]:
        by_chain.setdefault(residue["chain"], {})[residue["number"]] = residue["sec"]
    assert by_chain["A1"] == by_chain["A2"]


_HEME = """\
REMARK 350 BIOMOLECULE: 1
REMARK 350 AUTHOR DETERMINED BIOLOGICAL UNIT: DIMERIC
REMARK 350 APPLY THE FOLLOWING TO CHAINS: A
REMARK 350   BIOMT1   1  1.000000  0.000000  0.000000        0.00000
REMARK 350   BIOMT2   1  0.000000  1.000000  0.000000        0.00000
REMARK 350   BIOMT3   1  0.000000  0.000000  1.000000        0.00000
REMARK 350   BIOMT1   2 -1.000000  0.000000  0.000000        0.00000
REMARK 350   BIOMT2   2  0.000000 -1.000000  0.000000        0.00000
REMARK 350   BIOMT3   2  0.000000  0.000000  1.000000        0.00000
ATOM      1 FE   HEM A   1       0.000   0.000   0.000  1.00  0.00          FE
ATOM      2  NA  HEM A   1       0.000   0.000   2.050  1.00  0.00           N
END
"""


def test_heme_iron_does_not_block_assembly_load(tmp_path: Path) -> None:
    pdb_path = tmp_path / "heme.pdb"
    pdb_path.write_text(_HEME, encoding="utf-8")
    built = build_assembly(pdb_path, "1")
    data = get_structure(
        StructureRequest(path=built["path"], needs_bonds=True, needs_secondary_structure=False)
    )
    assert set(data["atoms"]["chain_id"]) == {"A1", "A2"}
    assert data["bonds"]


def test_save_pdb_writes_a_reopenable_pdb(tmp_path: Path) -> None:
    pdb_path = tmp_path / "dimer.pdb"
    pdb_path.write_text(_DIMER, encoding="utf-8")
    built = build_assembly(pdb_path, "1")
    dest = tmp_path / "saved.pdb"
    edit_save_pdb(EditSavePdbRequest(source=built["path"], dest=str(dest)))
    text = dest.read_text(encoding="utf-8")
    assert text.startswith("HEADER")
    assert "data_" not in text.splitlines()[0]
    universe = mda.Universe(str(dest), topology_format="XPDB", format="PDB")
    assert universe.atoms.n_atoms == built["n_atoms"]


def test_mislabeled_assembly_pdb_keeps_chain_names(tmp_path: Path) -> None:
    pdb_path = tmp_path / "dimer.pdb"
    pdb_path.write_text(_DIMER, encoding="utf-8")
    built = build_assembly(pdb_path, "1")
    copied = tmp_path / "copied.pdb"
    copied.write_text(Path(built["path"]).read_text(encoding="utf-8"), encoding="utf-8")
    data = get_structure(
        StructureRequest(path=str(copied), needs_bonds=False, needs_secondary_structure=False)
    )
    assert set(data["atoms"]["chain_id"]) == {"A1", "A2"}


def test_detect_molecules_reads_plain_mmcif(tmp_path: Path) -> None:
    cif_path = tmp_path / "plain.cif"
    cif_path.write_text(
        """data_test
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_alt_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.label_seq_id
_atom_site.pdbx_PDB_ins_code
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
_atom_site.occupancy
_atom_site.B_iso_or_equiv
_atom_site.auth_seq_id
_atom_site.auth_asym_id
_atom_site.pdbx_PDB_model_num
ATOM 1 N N . ALA A 1 ? 0.000 0.000 0.000 1.00 0.00 1 A 1
ATOM 2 C CA . ALA A 1 ? 1.000 0.000 0.000 1.00 0.00 1 A 1
""",
        encoding="utf-8",
    )
    found = detect_molecules(DetectMoleculesRequest(path=str(cif_path)))
    assert any(item["selection"] == "protein" for item in found)


def test_assembly_secondary_structure_copies_onto_each_chain(tmp_path: Path, monkeypatch) -> None:
    written: list[str] = []

    def fake(path, method="auto"):
        written.append(path)
        universe = mda.Universe(path)
        chains = {str(atom.chainID).strip() for atom in universe.atoms}
        assert chains == {"A"}
        return {("A", int(residue.resid)): "H" for residue in universe.residues}

    monkeypatch.setattr("app.assign_secondary_structure_map", fake)
    pdb_path = tmp_path / "dimer.pdb"
    pdb_path.write_text(_DIMER, encoding="utf-8")
    built = build_assembly(pdb_path, "1")
    data = get_structure(
        StructureRequest(
            path=built["path"],
            needs_bonds=False,
            needs_secondary_structure=True,
        )
    )
    secs = {(residue["chain"], residue["number"]): residue["sec"] for residue in data["residues"]}
    assert secs[("A1", 1)] == "H"
    assert secs[("A2", 1)] == "H"
    assert len(written) == 1
    assert written[0].endswith(".pdb")

    found = detect_molecules(DetectMoleculesRequest(path=built["path"]))
    protein = next(item for item in found if item["selection"] == "protein")
    detected = {
        (residue["chain"], residue["number"]): residue["sec"] for residue in protein["residues"]
    }
    assert detected[("A1", 1)] == "H"
    assert detected[("A2", 1)] == "H"
    assert len(written) == 2


def test_detect_molecules_reads_assembly_mmcif(tmp_path: Path) -> None:
    pdb_path = tmp_path / "dimer.pdb"
    pdb_path.write_text(_DIMER, encoding="utf-8")
    built = build_assembly(pdb_path, "1")
    found = detect_molecules(DetectMoleculesRequest(path=built["path"]))
    assert any(item["selection"] == "protein" for item in found)
