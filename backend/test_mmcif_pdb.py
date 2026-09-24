"""mmCIF → PDB conversion, including hybrid-36 serials past 99,999."""

from pathlib import Path

import MDAnalysis as mda
from MDAnalysis.topology.PDBParser import hy36decode

from mmcif_pdb import hy36encode, mda_topology_format, pdb_from_mmcif

TINY_CIF = """data_test
#
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
ATOM 1 C CA . ALA A 10 ? 1.500 2.250 -3.125 1.00 20.00 10 A 1
"""


def test_hybrid36_matches_mdanalysis_decoder():
    assert hy36encode(5, 1) == "    1"
    assert hy36encode(5, 99999) == "99999"
    assert hy36encode(5, 100000) == "A0000"
    assert hy36decode(5, hy36encode(5, 105072)) == 105072


def test_chain_restart_keeps_author_residue_numbers(tmp_path: Path):
    cif = tmp_path / "chains.cif"
    cif.write_text(
        TINY_CIF.replace(
            "ATOM 1 C CA . ALA A 10 ? 1.500 2.250 -3.125 1.00 20.00 10 A 1\n",
            "ATOM 1 C CA . ALA A 10 ? 1.500 2.250 -3.125 1.00 20.00 6000 A 1\n"
            "ATOM 2 C CA . ALA B 11 ? 4.500 2.250 -3.125 1.00 20.00 1 B 1\n",
        ),
        encoding="utf-8",
    )
    pdb = pdb_from_mmcif(cif)
    universe = mda.Universe(str(pdb), topology_format=mda_topology_format(pdb), format="PDB")
    residues = [(str(atom.chainID).strip(), int(atom.resid)) for atom in universe.atoms]
    assert residues == [("A", 6000), ("B", 1)]


def test_tiny_cif_becomes_pdb_mdanalysis_can_read(tmp_path: Path):
    cif = tmp_path / "tiny.cif"
    cif.write_text(TINY_CIF, encoding="utf-8")
    pdb = pdb_from_mmcif(cif)
    assert pdb.suffix == ".pdb"
    universe = mda.Universe(str(pdb))
    assert len(universe.atoms) == 1
    atom = universe.atoms[0]
    assert atom.resname == "ALA"
    assert str(atom.chainID).strip() == "A"
    assert int(atom.resid) == 10
    assert atom.name.strip() == "CA"
    again = pdb_from_mmcif(cif)
    assert again == pdb
