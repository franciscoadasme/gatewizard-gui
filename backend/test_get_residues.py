"""Residue CA lookup must not use MDAnalysis select_atoms (parser is not thread-safe)."""

from pathlib import Path

import MDAnalysis as mda

from app import _residue_ca_index, get_residues


def _tiny_universe(tmp_path: Path) -> mda.Universe:
    pdb = tmp_path / "ca.pdb"
    pdb.write_text(
        "ATOM      1  N   MET A   1       0.000   0.000   0.000  1.00  0.00           N\n"
        "ATOM      2  CA  MET A   1       1.000   0.000   0.000  1.00  0.00           C\n"
        "ATOM      3  C   MET A   1       2.000   0.000   0.000  1.00  0.00           C\n"
        "HETATM    4  K     K A 302      10.000   0.000   0.000  1.00  0.00           K\n"
        "END\n",
        encoding="utf-8",
    )
    return mda.Universe(str(pdb))


def test_residue_ca_index_protein_and_ion(tmp_path):
    u = _tiny_universe(tmp_path)
    met = u.residues[0]
    ion = u.residues[1]
    assert _residue_ca_index(met) == int(met.atoms[1].index)
    assert _residue_ca_index(ion) is None


def test_get_residues_includes_ion_without_select_atoms(tmp_path):
    u = _tiny_universe(tmp_path)
    rows = get_residues(u, needs_secondary_structure=False)
    assert len(rows) == 2
    by_name = {r["resname"]: r for r in rows}
    assert by_name["MET"]["ca_index"] is not None
    assert by_name["K"]["ca_index"] is None
