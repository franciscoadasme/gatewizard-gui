"""Numbered PDB paths for selection minimization."""

from app import _next_minimized_pdb


def test_first_run_creates_a_minimized_folder(tmp_path):
    src = tmp_path / "6rv2_ab_protonated.pdb"
    src.write_text("END\n", encoding="utf-8")
    assert _next_minimized_pdb(str(src)) == str(tmp_path / "minimized" / "6rv2_ab_protonated_min_001.pdb")


def test_later_runs_use_the_next_number(tmp_path):
    folder = tmp_path / "minimized"
    folder.mkdir()
    first = folder / "6rv2_ab_protonated_min_001.pdb"
    first.write_text("END\n", encoding="utf-8")
    assert _next_minimized_pdb(str(first)) == str(folder / "6rv2_ab_protonated_min_002.pdb")


def test_old_minimized_name_starts_a_numbered_series(tmp_path):
    src = tmp_path / "6rv2_ab_protonated_minimized.pdb"
    src.write_text("END\n", encoding="utf-8")
    assert _next_minimized_pdb(str(src)) == str(tmp_path / "minimized" / "6rv2_ab_protonated_min_001.pdb")
