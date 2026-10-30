"""Tests for Maestro / multi-MODEL PDB inspect + import."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from structure_import import import_structure_entries, inspect_structure_file


@pytest.fixture()
def cache_tmp(tmp_path, monkeypatch):
    monkeypatch.setenv("GATEWIZARD_STRUCTURE_CACHE", str(tmp_path / "structure_cache"))
    return tmp_path


def _write_multi_model_pdb(path: Path, n_models: int = 3) -> None:
    lines = []
    for m in range(1, n_models + 1):
        lines.append(f"MODEL     {m}")
        lines.append(
            f"ATOM      1  CA  ALA A   1      {float(m):6.3f}  0.000  0.000  1.00  0.00           C"
        )
        lines.append("ENDMDL")
    lines.append("END")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def test_inspect_multi_model_pdb(cache_tmp, tmp_path):
    pdb = tmp_path / "multi.pdb"
    _write_multi_model_pdb(pdb, 3)
    info = inspect_structure_file(pdb)
    assert info["kind"] == "pdb_models"
    assert len(info["entries"]) == 3
    assert info["entries"][0]["index"] == 0
    assert "model 1" in info["entries"][0]["label"].lower() or "model" in info["entries"][0]["label"].lower()


def test_import_multi_model_pdb(cache_tmp, tmp_path):
    pdb = tmp_path / "multi.pdb"
    _write_multi_model_pdb(pdb, 2)
    result = import_structure_entries(pdb, [0, 1])
    assert result["kind"] == "pdb_models"
    assert len(result["structures"]) == 2
    for s in result["structures"]:
        pdb_path = Path(s.get("pdbPath") or s["path"])
        assert pdb_path.is_file()
        assert s["kind"] == "pdb_model"
        text = pdb_path.read_text(encoding="utf-8")
        assert "ATOM" in text


def test_inspect_single_pdb(cache_tmp, tmp_path):
    pdb = tmp_path / "one.pdb"
    pdb.write_text(
        "ATOM      1  CA  ALA A   1       0.000  0.000  0.000  1.00  0.00           C\nEND\n",
        encoding="utf-8",
    )
    info = inspect_structure_file(pdb)
    assert info["kind"] == "single"
    assert len(info["entries"]) == 1


def test_inspect_maestro_if_rdkit_available(cache_tmp, tmp_path):
    rdkit = pytest.importorskip("rdkit")
    from rdkit import Chem

    # Minimal synthetic MAE-like content is fragile; skip if MaeMolSupplier unavailable.
    if not hasattr(Chem, "MaeMolSupplier"):
        pytest.skip("RDKit MaeMolSupplier not available")

    # Write a tiny SDF and convert via OpenBabel if available is out of scope;
    # exercise the error path for a non-MAE file renamed, and accept skip on empty.
    mae = tmp_path / "empty.mae"
    mae.write_text("f_m_ct {\n}\n", encoding="utf-8")
    try:
        info = inspect_structure_file(mae)
    except RuntimeError:
        pytest.skip("Could not parse synthetic MAE with available backends")
    assert info["kind"] == "maestro"
    assert isinstance(info["entries"], list)


def test_annotate_bonds_with_orders_matches_pairs():
    from structure_import import annotate_bonds_with_orders

    bonds = [[0, 1], [1, 2], [2, 3]]
    orders = [[0, 1, 2], [2, 3, 3]]
    out = annotate_bonds_with_orders(bonds, orders)
    assert out == [[0, 1, 2], [1, 2, 1], [2, 3, 3]]


def test_annotate_bonds_falls_back_to_sidecar_on_index_mismatch():
    from structure_import import annotate_bonds_with_orders

    # CONECT pairs don't overlap multi-order sidecar keys → use sidecar.
    bonds = [[10, 11], [11, 12]]
    orders = [[0, 1, 2], [1, 2, 1]]
    out = annotate_bonds_with_orders(bonds, orders)
    assert [0, 1, 2] in out
    assert all(len(b) == 3 for b in out)


def test_bond_orders_from_mol_detects_double():
    pytest.importorskip("rdkit")
    from rdkit import Chem

    from structure_import import _bond_orders_from_mol

    mol = Chem.AddHs(Chem.MolFromSmiles("C=O"))
    orders = _bond_orders_from_mol(mol)
    assert any(o == 2 for _, _, o in orders)


class _Atom:
    def __init__(self, index, name, element, pos=(0.0, 0.0, 0.0)):
        self.index = index
        self.name = name
        self.element = element
        self.position = pos


class _Residue:
    def __init__(self, resname, atoms):
        self.resname = resname
        self.atoms = atoms


class _Universe:
    def __init__(self, residues):
        self.residues = residues


def test_template_assigns_carbonyl_and_phenyl_doubles():
    from structure_import import perceive_bond_orders

    ala = _Residue(
        "ALA",
        [
            _Atom(0, "N", "N"),
            _Atom(1, "H", "H"),
            _Atom(2, "CA", "C"),
            _Atom(3, "HA", "H"),
            _Atom(4, "C", "C"),
            _Atom(5, "O", "O"),
        ],
    )
    phe = _Residue(
        "PHE",
        [
            _Atom(6, "N", "N"),
            _Atom(7, "H", "H"),
            _Atom(8, "CA", "C"),
            _Atom(9, "C", "C"),
            _Atom(10, "O", "O"),
            _Atom(11, "CG", "C"),
            _Atom(12, "CD1", "C"),
            _Atom(13, "CD2", "C"),
            _Atom(14, "CE1", "C"),
            _Atom(15, "CE2", "C"),
            _Atom(16, "CZ", "C"),
        ],
    )
    orders = perceive_bond_orders([ala, phe])
    pairs = {(min(i, j), max(i, j)): order for i, j, order in orders}
    assert pairs[(4, 5)] == 2
    assert pairs[(9, 10)] == 2
    assert pairs[(11, 13)] == 2
    assert pairs[(12, 14)] == 2
    assert pairs[(15, 16)] == 2


def test_template_assigns_nucleic_base_doubles():
    from structure_import import perceive_bond_orders

    adenine = _Residue(
        "DA",
        [
            _Atom(0, "N1", "N"),
            _Atom(1, "C2", "C"),
            _Atom(2, "N3", "N"),
            _Atom(3, "C4", "C"),
            _Atom(4, "C5", "C"),
            _Atom(5, "C6", "C"),
            _Atom(6, "N7", "N"),
            _Atom(7, "C8", "C"),
            _Atom(8, "H8", "H"),
        ],
    )
    orders = perceive_bond_orders([adenine])
    pairs = {(min(i, j), max(i, j)) for i, j, order in orders}
    assert pairs == {(0, 5), (1, 2), (3, 4), (6, 7)}


def test_template_skips_protein_without_hydrogens():
    from structure_import import perceive_bond_orders

    bare = _Residue(
        "ALA",
        [
            _Atom(0, "N", "N"),
            _Atom(1, "CA", "C"),
            _Atom(2, "C", "C"),
            _Atom(3, "O", "O"),
        ],
    )
    assert perceive_bond_orders([bare]) == []


def test_ash_double_bond_is_the_unprotonated_oxygen():
    from structure_import import perceive_bond_orders

    ash = _Residue(
        "ASH",
        [
            _Atom(0, "N", "N"),
            _Atom(1, "H", "H"),
            _Atom(2, "CG", "C"),
            _Atom(3, "OD1", "O"),
            _Atom(4, "OD2", "O"),
            _Atom(5, "HD2", "H"),
            _Atom(6, "C", "C"),
            _Atom(7, "O", "O"),
        ],
    )
    orders = perceive_bond_orders([ash])
    pairs = {(min(i, j), max(i, j)): order for i, j, order in orders}
    assert pairs[(2, 3)] == 2
    assert (2, 4) not in pairs
    assert pairs[(6, 7)] == 2


def test_deprotonated_asp_keeps_one_carboxylate_double():
    from structure_import import perceive_bond_orders

    asp = _Residue(
        "ASP",
        [
            _Atom(0, "N", "N"),
            _Atom(1, "H", "H"),
            _Atom(2, "CG", "C"),
            _Atom(3, "OD1", "O"),
            _Atom(4, "OD2", "O"),
        ],
    )
    orders = perceive_bond_orders([asp])
    pairs = {(min(i, j), max(i, j)) for i, j, order in orders if order >= 2}
    assert (2, 3) in pairs
    assert (2, 4) not in pairs


def test_hetero_residue_uses_rdkit_and_a_failure_stays_single():
    pytest.importorskip("rdkit")
    from structure_import import perceive_bond_orders

    ligand = _Residue(
        "UNL",
        [
            _Atom(0, "C1", "C", (0.0, 0.0, 0.0)),
            _Atom(1, "O1", "O", (1.21, 0.0, 0.0)),
            _Atom(2, "H1", "H", (-0.60, 0.95, 0.0)),
            _Atom(3, "H2", "H", (-0.60, -0.95, 0.0)),
        ],
    )
    broken = _Residue(
        "LIG",
        [
            _Atom(4, "C1", "C", (0.0, 0.0, 0.0)),
            _Atom(5, "H1", "H", (0.0, 0.0, 0.0)),
        ],
    )
    orders = perceive_bond_orders([ligand, broken])
    assert [0, 1, 2] in orders
    assert all(i < 4 for i, j, _order in orders)


def test_resolve_caches_sidecar_and_refreshes_when_pdb_is_newer(tmp_path):
    from structure_import import resolve_viewer_bond_orders

    pdb = tmp_path / "prepared.pdb"
    pdb.write_text("END\n", encoding="utf-8")
    ala = _Residue(
        "ALA",
        [
            _Atom(0, "C", "C"),
            _Atom(1, "O", "O"),
            _Atom(2, "HA", "H"),
        ],
    )
    universe = _Universe([ala])
    bonds = [[0, 1], [0, 2]]
    first = resolve_viewer_bond_orders(pdb, universe, None, bonds=bonds)
    assert first == [[0, 1, 2]]
    sidecar = tmp_path / "prepared.bonds.json"
    assert sidecar.is_file()
    cached_mtime = sidecar.stat().st_mtime

    second = resolve_viewer_bond_orders(pdb, _Universe([]), None, bonds=bonds)
    assert second == [[0, 1, 2]]
    assert sidecar.stat().st_mtime == cached_mtime

    aged = cached_mtime - 100
    os.utime(sidecar, (aged, aged))
    os.utime(pdb, (aged + 30, aged + 30))
    third = resolve_viewer_bond_orders(pdb, universe, None, bonds=bonds)
    assert third == [[0, 1, 2]]
    assert sidecar.stat().st_mtime >= pdb.stat().st_mtime


def test_resolve_skips_perception_when_topology_is_loaded(tmp_path):
    from structure_import import resolve_viewer_bond_orders

    pdb = tmp_path / "with_top.pdb"
    pdb.write_text("END\n", encoding="utf-8")
    ala = _Residue(
        "ALA",
        [_Atom(0, "C", "C"), _Atom(1, "O", "O"), _Atom(2, "H", "H")],
    )
    orders = resolve_viewer_bond_orders(
        pdb, _Universe([ala]), "with_top.prmtop", bonds=[[0, 1]]
    )
    assert orders is None
    assert not (tmp_path / "with_top.bonds.json").exists()


def test_prepared_pdb_orders_follow_mdanalysis_indices(tmp_path):
    pytest.importorskip("rdkit")
    mda = pytest.importorskip("MDAnalysis")
    from MDAnalysis.guesser.default_guesser import DefaultGuesser
    from rdkit import Chem
    from rdkit.Chem import AllChem

    from structure_import import annotate_bonds_with_orders, resolve_viewer_bond_orders

    mol = Chem.AddHs(Chem.MolFromSmiles("C=O"))
    assert AllChem.EmbedMolecule(mol, randomSeed=1) == 0
    lines = [
        line
        for line in Chem.MolToPDBBlock(mol).splitlines()
        if not line.startswith("CONECT")
    ]
    pdb = tmp_path / "carbonyl.pdb"
    pdb.write_text("\n".join(lines) + "\n", encoding="utf-8")
    universe = mda.Universe(str(pdb))
    guesser = DefaultGuesser(None, fudge_factor=0.55, lower_bound=0.1, box=None)
    bonds = [
        [int(i), int(j)]
        for i, j in guesser.guess_bonds(universe.atoms, universe.atoms.positions)
    ]
    orders = resolve_viewer_bond_orders(pdb, universe, None, bonds=bonds)
    merged = annotate_bonds_with_orders(bonds, orders)
    assert any(order >= 2 for _i, _j, order in merged)
    assert (tmp_path / "carbonyl.bonds.json").is_file()


def test_perceived_orders_merge_onto_guessed_bonds():
    from structure_import import annotate_bonds_with_orders, perceive_bond_orders

    ala = _Residue(
        "ALA",
        [
            _Atom(0, "N", "N"),
            _Atom(1, "H", "H"),
            _Atom(2, "CA", "C"),
            _Atom(3, "C", "C"),
            _Atom(4, "O", "O"),
        ],
    )
    orders = perceive_bond_orders([ala])
    guessed = [[0, 2], [2, 3], [3, 4]]
    merged = annotate_bonds_with_orders(guessed, orders)
    assert merged == [[0, 2, 1], [2, 3, 1], [3, 4, 2]]


def _write_mae_with_props(path: Path) -> None:
    """Write a one-CT Maestro file with score props via RDKit MaeWriter."""
    from rdkit import Chem

    mol = Chem.AddHs(Chem.MolFromSmiles("C=O"))
    assert mol is not None
    mol.SetProp("_Name", "pose1")
    mol.SetDoubleProp("r_i_docking_score", -8.5)
    mol.SetDoubleProp("r_psp_MMGBSA_dG_Bind", -42.3)
    mol.SetIntProp("i_i_glide_lignum", 3)
    mol.SetProp("s_user_note", "ok")
    mol.SetProp("s_m_pdb_file", "X" * 600)
    writer = Chem.MaeWriter(str(path))
    writer.write(mol)
    writer.close()


def test_maestro_ct_properties_keeps_scores_and_drops_huge_strings(cache_tmp, tmp_path):
    pytest.importorskip("rdkit")
    from rdkit import Chem

    from structure_import import _maestro_ct_properties

    if not hasattr(Chem, "MaeWriter"):
        pytest.skip("RDKit MaeWriter not available")

    mae = tmp_path / "scored.mae"
    _write_mae_with_props(mae)
    supplier = Chem.MaeMolSupplier(str(mae), sanitize=False, removeHs=False)
    mol = next(iter(supplier))
    assert mol is not None
    props = {p["name"]: p for p in _maestro_ct_properties(mol)}
    assert props["r_i_docking_score"]["type"] == "real"
    assert props["r_i_docking_score"]["value"] == pytest.approx(-8.5)
    assert props["r_psp_MMGBSA_dG_Bind"]["value"] == pytest.approx(-42.3)
    assert props["i_i_glide_lignum"] == {"name": "i_i_glide_lignum", "type": "integer", "value": 3}
    assert props["s_user_note"] == {"name": "s_user_note", "type": "string", "value": "ok"}
    assert "s_m_pdb_file" not in props
    assert "_Name" not in props


def test_inspect_and_import_maestro_include_properties(cache_tmp, tmp_path):
    pytest.importorskip("rdkit")
    from rdkit import Chem

    if not hasattr(Chem, "MaeWriter") or not hasattr(Chem, "MaeMolSupplier"):
        pytest.skip("RDKit Maestro I/O not available")

    mae = tmp_path / "scored.mae"
    _write_mae_with_props(mae)
    info = inspect_structure_file(mae)
    assert info["kind"] == "maestro"
    assert len(info["entries"]) == 1
    names = {p["name"] for p in info["entries"][0]["properties"]}
    assert "r_i_docking_score" in names
    assert "s_user_note" in names
    assert "s_m_pdb_file" not in names

    result = import_structure_entries(mae, [0])
    assert len(result["structures"]) == 1
    imported_names = {p["name"] for p in result["structures"][0]["properties"]}
    assert "r_psp_MMGBSA_dG_Bind" in imported_names
    assert "s_m_pdb_file" not in imported_names


def test_maestro_without_extra_props_still_imports(cache_tmp, tmp_path):
    pytest.importorskip("rdkit")
    from rdkit import Chem

    if not hasattr(Chem, "MaeWriter") or not hasattr(Chem, "MaeMolSupplier"):
        pytest.skip("RDKit Maestro I/O not available")

    mae = tmp_path / "plain.mae"
    mol = Chem.AddHs(Chem.MolFromSmiles("C"))
    assert mol is not None
    mol.SetProp("_Name", "plain")
    writer = Chem.MaeWriter(str(mae))
    writer.write(mol)
    writer.close()

    info = inspect_structure_file(mae)
    assert info["kind"] == "maestro"
    assert info["entries"][0]["properties"] == [] or isinstance(
        info["entries"][0]["properties"], list
    )
    result = import_structure_entries(mae, [0])
    assert len(result["structures"]) == 1
    assert isinstance(result["structures"][0].get("properties"), list)


def test_inspect_multi_mol_sdf(cache_tmp, tmp_path):
    pytest.importorskip("rdkit")
    from rdkit import Chem

    sdf = tmp_path / "ligands.sdf"
    writer = Chem.SDWriter(str(sdf))
    for smiles, name in (("CCO", "ethanol"), ("c1ccccc1", "benzene")):
        mol = Chem.MolFromSmiles(smiles)
        assert mol is not None
        mol.SetProp("_Name", name)
        writer.write(mol)
    writer.close()

    info = inspect_structure_file(sdf)
    assert info["kind"] == "chem_mols"
    assert len(info["entries"]) == 2
    assert "ethanol" in info["entries"][0]["label"].lower()

    result = import_structure_entries(sdf, [0, 1])
    assert result["kind"] == "chem_mols"
    assert len(result["structures"]) == 2
    for s in result["structures"]:
        assert s["kind"] == "chem_mol"
        pdb_path = Path(s.get("pdbPath") or s["path"])
        assert pdb_path.is_file()
        text = pdb_path.read_text(encoding="utf-8")
        assert "ATOM" in text or "HETATM" in text
        orders = Path(pdb_path.parent / f"{pdb_path.stem}.bonds.json")
        assert orders.is_file()


def test_inspect_single_mol2_is_single(cache_tmp, tmp_path):
    pytest.importorskip("rdkit")
    from rdkit import Chem

    mol2 = tmp_path / "one.mol2"
    # Minimal Tripos MOL2 (RDKit may lack MolToMol2File on some builds).
    mol2.write_text(
        "@<TRIPOS>MOLECULE\n"
        "ethanol\n"
        "3 2 0 0 0\n"
        "SMALL\n"
        "NO_CHARGES\n"
        "\n"
        "@<TRIPOS>ATOM\n"
        "      1 C1         0.0000    0.0000    0.0000 C.3       1 UNL      0.0000\n"
        "      2 C2         1.5000    0.0000    0.0000 C.3       1 UNL      0.0000\n"
        "      3 O1         2.2000    1.0000    0.0000 O.3       1 UNL      0.0000\n"
        "@<TRIPOS>BOND\n"
        "     1     1     2    1\n"
        "     2     2     3    1\n",
        encoding="utf-8",
    )
    # Confirm RDKit can read it; otherwise single-pass-through still applies.
    mol = Chem.MolFromMol2File(str(mol2), sanitize=False, removeHs=False)
    if mol is None:
        pytest.skip("RDKit could not parse minimal MOL2")
    info = inspect_structure_file(mol2)
    assert info["kind"] == "single"


def test_app_companion_suffixes_include_tpr():
    """GRO/TPR companion wiring lives in app.py (heavy import; assert source)."""
    text = (Path(__file__).parent / "app.py").read_text(encoding="utf-8")
    assert '_TOPOLOGY_COMPANION_SUFFIXES = (".prmtop", ".parm7", ".psf", ".tpr")' in text
    assert '".tpr"' in text
    assert '".tpr"' in text[text.index("_TOPOLOGY_ONLY_SUFFIXES") :]
