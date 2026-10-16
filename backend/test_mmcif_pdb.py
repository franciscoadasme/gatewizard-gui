"""mmCIF → PDB conversion, including hybrid-36 serials past 99,999."""

from pathlib import Path

import MDAnalysis as mda
from MDAnalysis.topology.PDBParser import hy36decode

from mmcif_pdb import hy36encode, mda_topology_format, pdb_from_mmcif, pdb_reader_sources

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


def test_overflowed_residue_number_is_rewritten_for_mdanalysis(tmp_path: Path):
    """Amber writes residue 100000 in the 4-column field, so y becomes '6 104.47'."""
    pdb = tmp_path / "big.pdb"
    pdb.write_text(
        "CRYST1  244.199  243.184  172.213  90.00  90.00  90.00 P 1           1\n"
        "ATOM  541038 O   WAT  100000     22.056 104.478  74.348  1.00  0.00\n"
        "ATOM  903554 H2  WAT  220838    -63.710 -92.769  70.293  1.00  0.00\n"
        "END\n",
        encoding="utf-8",
    )
    coordinates, topology = pdb_reader_sources(pdb)
    assert coordinates != pdb
    assert topology is not None
    universe = mda.Universe(str(topology), str(coordinates))
    assert len(universe.atoms) == 2
    assert [int(atom.resid) for atom in universe.atoms] == [100000, 220838]
    assert [atom.name.strip() for atom in universe.atoms] == ["O", "H2"]
    assert abs(float(universe.atoms[0].position[1]) - 104.478) < 0.001
    assert abs(float(universe.atoms[1].position[0]) - (-63.710)) < 0.001


def test_glued_negative_coordinate_is_split(tmp_path: Path):
    """A full-width negative coordinate is written with no space before it."""
    pdb = tmp_path / "glued.pdb"
    pdb.write_text(
        "ATOM  541038 O   WAT  100000     22.056  46.591-107.358  1.00  0.00\n"
        "END\n",
        encoding="utf-8",
    )
    coordinates, topology = pdb_reader_sources(pdb)
    universe = mda.Universe(str(topology), str(coordinates))
    position = universe.atoms[0].position
    assert abs(float(position[0]) - 22.056) < 0.001
    assert abs(float(position[1]) - 46.591) < 0.001
    assert abs(float(position[2]) - (-107.358)) < 0.001


def test_serial_past_99999_glued_to_atom_name(tmp_path: Path):
    """Serial 100044 overwrites the blank before the atom name."""
    pdb = tmp_path / "serial.pdb"
    pdb.write_text(
        "ATOM  100044C110 OL   5661     -42.676 -46.832 -29.426  1.00  0.00\n"
        "END\n",
        encoding="utf-8",
    )
    coordinates, topology = pdb_reader_sources(pdb)
    universe = mda.Universe(str(topology), str(coordinates))
    atom = universe.atoms[0]
    assert atom.name.strip() == "C110"
    assert atom.resname.strip() == "OL"
    assert int(atom.resid) == 5661
    assert abs(float(atom.position[0]) - (-42.676)) < 0.001


def test_spilled_serial_does_not_become_chloride_name(tmp_path: Path):
    """Serial 272291 written against Cl- is chloride, not an atom named 1Cl-."""
    pdb = tmp_path / "chloride.pdb"
    pdb.write_text(
        "HETATM 272291Cl- CL     12      10.000  20.000  30.000  1.00  0.00\n"
        "END\n",
        encoding="utf-8",
    )
    coordinates, topology = pdb_reader_sources(pdb)
    universe = mda.Universe(str(topology), str(coordinates))
    atom = universe.atoms[0]
    assert atom.name.strip() == "Cl-"
    assert atom.resname.strip() == "CL"


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
