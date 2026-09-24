"""Chain split and sequence-guided superposition."""

from pathlib import Path

import MDAnalysis as mda
import numpy as np
from Bio.PDB import Chain, Model, PDBIO, Residue, Structure
from Bio.PDB.Atom import Atom

from visualize_superimpose import split_chain, superimpose_structures

_ALA = {
    "N": np.array([-22.643, 18.456, -32.033]),
    "CA": np.array([-23.103, 17.168, -31.547]),
    "C": np.array([-23.671, 17.301, -30.151]),
    "O": np.array([-23.155, 18.043, -29.318]),
    "CB": np.array([-21.968, 16.160, -31.557]),
}


def _write_peptide(path: Path, chains, n=6, resname="ALA", origin=(0.0, 0.0, 0.0), ligand=False):
    structure = Structure.Structure("pep")
    model = Model.Model(0)
    structure.add(model)
    serial = 1
    origin = np.asarray(origin, dtype=float)
    for chain_index, chain_id in enumerate(chains):
        chain = Chain.Chain(chain_id)
        model.add(chain)
        for index in range(n):
            residue = Residue.Residue((" ", index + 1, " "), resname, " ")
            shift = origin + np.array([index * 3.8, 0.0, chain_index * 40.0]) - _ALA["CA"]
            for name, coord in _ALA.items():
                residue.add(
                    Atom(name, coord + shift, 1.0, 1.0, " ", f"{name:>4}", serial, name[0])
                )
                serial += 1
            chain.add(residue)
        if ligand:
            ligand_res = Residue.Residue(("H_LIG", 1, " "), "LIG", " ")
            ligand_res.add(
                Atom(
                    "C1",
                    origin + np.array([0.0, 6.0, chain_index * 40.0]),
                    1.0,
                    1.0,
                    " ",
                    " C1 ",
                    serial,
                    "C",
                )
            )
            serial += 1
            chain.add(ligand_res)
    writer = PDBIO()
    writer.set_structure(structure)
    writer.save(str(path))


def test_split_writes_only_the_requested_chain(tmp_path):
    pdb = tmp_path / "dimer.pdb"
    _write_peptide(pdb, ("A", "B"), n=4, ligand=True)
    result = split_chain(str(pdb), "A")
    universe = mda.Universe(result["path"])
    assert set(universe.atoms.chainIDs) == {"A"}
    assert result["n_atoms"] == len(universe.atoms)
    assert "LIG" in set(universe.atoms.resnames)
    source = mda.Universe(str(pdb))
    assert set(source.atoms.chainIDs) == {"A", "B"}
    assert len(universe.atoms) < len(source.atoms)


def test_superimpose_copy_is_identity(tmp_path):
    reference = tmp_path / "ref.pdb"
    mobile = tmp_path / "mob.pdb"
    _write_peptide(reference, ("A",), n=6, ligand=True)
    _write_peptide(mobile, ("B",), n=6, origin=(12.0, -3.0, 5.0), ligand=True)
    ref_before = mda.Universe(str(reference)).atoms.positions.copy()
    result = superimpose_structures(str(reference), "A", str(mobile), "B")
    ref_after = mda.Universe(str(reference)).atoms.positions.copy()
    assert np.allclose(ref_before, ref_after)
    assert result["n_anchors"] >= 3
    assert result["rmsd"] < 0.05
    fitted = mda.Universe(result["path"])
    ref = mda.Universe(str(reference))
    ref_ca = ref.select_atoms("name CA").positions
    mob_ca = fitted.select_atoms("name CA").positions
    assert np.allclose(ref_ca, mob_ca, atol=0.05)
    ref_lig = ref.select_atoms("resname LIG").positions
    mob_lig = fitted.select_atoms("resname LIG").positions
    assert np.allclose(ref_lig, mob_lig, atol=0.05)


def test_low_homology_does_not_move_atoms(tmp_path):
    reference = tmp_path / "glu.pdb"
    mobile = tmp_path / "trp.pdb"
    _write_peptide(reference, ("A",), n=6, resname="GLU")
    _write_peptide(mobile, ("A",), n=6, resname="TRP", origin=(8.0, 1.0, 0.0))
    before = mda.Universe(str(mobile)).atoms.positions.copy()
    try:
        superimpose_structures(str(reference), "A", str(mobile), "A")
    except ValueError as exc:
        assert "not moved" in str(exc).lower() or "too low" in str(exc).lower()
    else:
        raise AssertionError("expected a low-homology error")
    after = mda.Universe(str(mobile)).atoms.positions.copy()
    assert np.allclose(before, after)
