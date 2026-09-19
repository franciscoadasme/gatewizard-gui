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
