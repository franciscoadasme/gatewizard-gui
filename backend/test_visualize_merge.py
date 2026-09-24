"""Merging structures keeps complementary chains and refuses a real duplicate."""

from pathlib import Path

import MDAnalysis as mda
import numpy as np
import pytest
from Bio.PDB import Chain, Model, PDBIO, Residue, Structure
from Bio.PDB.Atom import Atom

from visualize_merge import merge_structures

_ALA = {
    "N": np.array([-22.643, 18.456, -32.033]),
    "CA": np.array([-23.103, 17.168, -31.547]),
    "C": np.array([-23.671, 17.301, -30.151]),
    "O": np.array([-23.155, 18.043, -29.318]),
    "CB": np.array([-21.968, 16.160, -31.557]),
}


def _write_peptide(path: Path, chains, n=2, origin=(0.0, 0.0, 0.0), start=1):
    structure = Structure.Structure("pep")
    model = Model.Model(0)
    structure.add(model)
    serial = 1
    origin = np.asarray(origin, dtype=float)
    for chain_index, chain_id in enumerate(chains):
        chain = Chain.Chain(chain_id)
        model.add(chain)
        for index in range(n):
            residue = Residue.Residue((" ", start + index, " "), "ALA", " ")
            shift = origin + np.array([index * 3.8, 0.0, chain_index * 40.0]) - _ALA["CA"]
            for name, coord in _ALA.items():
                residue.add(
                    Atom(name, coord + shift, 1.0, 1.0, " ", f"{name:>4}", serial, name[0])
                )
                serial += 1
            chain.add(residue)
    writer = PDBIO()
    writer.set_structure(structure)
    writer.save(str(path))


def test_merge_combines_distinct_chains(tmp_path):
    chain_a = tmp_path / "a.pdb"
    chain_c = tmp_path / "c.pdb"
    rest = tmp_path / "bd.pdb"
    _write_peptide(chain_a, ("A",), origin=(1.0, 2.0, 3.0))
    _write_peptide(chain_c, ("C",), origin=(4.0, 0.0, 0.0))
    _write_peptide(rest, ("B", "D"), origin=(8.0, -1.0, 2.0))
    result = merge_structures([str(chain_a), str(chain_c), str(rest)])
    universe = mda.Universe(result["path"])
    assert result["chains"] == ["A", "C", "B", "D"]
    assert set(universe.atoms.chainIDs) == {"A", "B", "C", "D"}
    assert result["n_atoms"] == len(universe.atoms)
    source_b = mda.Universe(str(rest)).select_atoms("chainID B").positions
    merged_b = universe.select_atoms("chainID B").positions
    assert np.allclose(merged_b, source_b)


def _write_ion(path: Path, chain_id, resid, resname="K", origin=(0.0, 0.0, 0.0)):
    structure = Structure.Structure("ion")
    model = Model.Model(0)
    structure.add(model)
    chain = Chain.Chain(chain_id)
    model.add(chain)
    residue = Residue.Residue((" ", resid, " "), resname, " ")
    residue.add(Atom(resname, np.asarray(origin, dtype=float), 1.0, 1.0, " ", f"{resname:>4}", 1, resname))
    chain.add(residue)
    writer = PDBIO()
    writer.set_structure(structure)
    writer.save(str(path))


def test_merge_keeps_protein_and_ions_that_share_a_chain_letter(tmp_path):
    protein = tmp_path / "prot.pdb"
    ions = tmp_path / "ions.pdb"
    _write_peptide(protein, ("A",), n=3)
    _write_ion(ions, "A", resid=401, origin=(4.0, 5.0, 6.0))
    result = merge_structures([str(protein), str(ions)])
    universe = mda.Universe(result["path"])
    assert set(universe.atoms.chainIDs) == {"A"}
    assert "K" in set(universe.atoms.resnames)
    assert int((universe.select_atoms("resname K").resids)[0]) == 401
    assert len(universe.select_atoms("protein")) == 15


def test_merge_rejects_a_repeated_chain(tmp_path):
    first = tmp_path / "a1.pdb"
    second = tmp_path / "a2.pdb"
    _write_peptide(first, ("A",))
    _write_peptide(second, ("A",), origin=(10.0, 0.0, 0.0))
    with pytest.raises(ValueError, match="Chain A"):
        merge_structures([str(first), str(second)])


def test_merge_rejects_the_same_ion_twice(tmp_path):
    first = tmp_path / "k1.pdb"
    second = tmp_path / "k2.pdb"
    _write_ion(first, "A", resid=401)
    _write_ion(second, "A", resid=401, origin=(3.0, 0.0, 0.0))
    with pytest.raises(ValueError, match="ion"):
        merge_structures([str(first), str(second)])


def test_merge_rejects_a_renumbered_copy_of_the_same_protein(tmp_path):
    first = tmp_path / "p1.pdb"
    second = tmp_path / "p2.pdb"
    _write_peptide(first, ("A",), n=2)
    _write_peptide(second, ("A",), n=2, origin=(10.0, 0.0, 0.0), start=10)
    with pytest.raises(ValueError, match="same 2 residues"):
        merge_structures([str(first), str(second)])
