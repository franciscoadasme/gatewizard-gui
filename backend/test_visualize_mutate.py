"""Rotamer listing and apply for the Visualize mutator."""

from pathlib import Path

import numpy as np
from Bio.PDB import Chain, Model, PDBIO, PDBParser, Residue, Structure
from Bio.PDB.Atom import Atom

from visualize_mutate import apply_mutation, list_rotamers, load_rotamer_library

import pymut

_ALA = {
    "N": np.array([-22.643, 18.456, -32.033]),
    "CA": np.array([-23.103, 17.168, -31.547]),
    "C": np.array([-23.671, 17.301, -30.151]),
    "O": np.array([-23.155, 18.043, -29.318]),
    "CB": np.array([-21.968, 16.160, -31.557]),
}


def _write_ala_peptide(path: Path, n: int = 3) -> None:
    structure = Structure.Structure("pep")
    model = Model.Model(0)
    structure.add(model)
    chain = Chain.Chain("A")
    model.add(chain)
    serial = 1
    for index in range(n):
        residue = Residue.Residue((" ", index + 1, " "), "ALA", " ")
        shift = np.array([index * 3.8, 0.0, 0.0]) - _ALA["CA"]
        for name, coord in _ALA.items():
            residue.add(
                Atom(
                    name,
                    coord + shift,
                    1.0,
                    1.0,
                    " ",
                    f"{name:>4}",
                    serial,
                    name[0],
                )
            )
            serial += 1
        chain.add(residue)
    writer = PDBIO()
    writer.set_structure(structure)
    writer.save(str(path))


def _coords(structure, resnum: int, name: str) -> np.ndarray:
    return np.asarray(structure[0]["A"][(" ", resnum, " ")][name].coord, dtype=float)


def test_rotamer_list_has_no_hydrogens_and_marks_lowest_energy(tmp_path):
    pdb = tmp_path / "ala3.pdb"
    _write_ala_peptide(pdb)
    listed = list_rotamers(str(pdb), "A", 2, "PHE")
    rotamers = listed["rotamers"]
    assert rotamers
    names = {atom["name"] for row in rotamers for atom in row["atoms"]}
    assert not any(name == "H" or (name.startswith("H") and (len(name) == 1 or name[1].isdigit())) for name in names)
    energies = [row["vdw"] for row in rotamers]
    best = next(row for row in rotamers if row["best"])
    assert best["vdw"] == min(energies)
    assert best["index"] == 0
    assert best["chi"]
    assert "CB" in {atom["name"] for atom in best["atoms"]}


def test_apply_matches_listed_side_chain_and_leaves_backbone(tmp_path):
    pdb = tmp_path / "ala3.pdb"
    _write_ala_peptide(pdb)
    original = PDBParser(QUIET=True).get_structure("in", str(pdb))
    listed = list_rotamers(str(pdb), "A", 2, "PHE")
    chosen = listed["rotamers"][0]
    written = apply_mutation(str(pdb), "A", 2, "PHE", chosen["index"])
    out = PDBParser(QUIET=True).get_structure("out", written["path"])
    residue = out[0]["A"][(" ", 2, " ")]
    assert residue.get_resname() == "PHE"
    atom_names = {atom.get_name().strip() for atom in residue.get_atoms()}
    assert not any(name == "H" or name.startswith("H") and name[1:2].isdigit() for name in atom_names)
    for name in ("N", "CA", "C", "O"):
        assert np.allclose(_coords(original, 2, name), _coords(out, 2, name), atol=1e-3)
    preview = {atom["name"]: np.array([atom["x"], atom["y"], atom["z"]]) for atom in chosen["atoms"]}
    for name, coord in preview.items():
        if name in ("N", "CA", "C", "O"):
            continue
        assert np.allclose(coord, residue[name].coord, atol=0.02)
    assert out[0]["A"][(" ", 1, " ")].get_resname() == "ALA"


def test_rotamer_library_is_the_full_dunbrack_table():
    lib = load_rotamer_library()
    counts = [len(rots) for bins in lib["PHE"].values() for rots in bins.values()]
    assert max(counts) > 5


def test_ala_has_a_single_placement_without_chi(tmp_path):
    pdb = tmp_path / "ala3.pdb"
    _write_ala_peptide(pdb)
    listed = list_rotamers(str(pdb), "A", 2, "ALA")
    assert len(listed["rotamers"]) == 1
    assert listed["rotamers"][0]["chi"] == []


def test_pymut_best_runs_without_hydrogens(tmp_path):
    """pyMUT's in-place clash loop is not the coordinate source for the UI."""
    pdb = tmp_path / "ala3.pdb"
    _write_ala_peptide(pdb)
    parser = PDBParser(QUIET=True)
    structure = parser.get_structure("pep", str(pdb))
    pymut.mutate(
        structure,
        "A",
        2,
        "PHE",
        rotamer_lib=load_rotamer_library(),
        mutation_type="best",
    )
    residue = structure[0]["A"][2]
    assert residue.get_resname() == "PHE"
    names = {atom.get_name().strip() for atom in residue.get_atoms()}
    assert "N" in names and "CB" in names
    assert not any(name == "H" or (name.startswith("H") and name[1:2].isdigit()) for name in names)
