"""Regression tests for PDB LINK bond parsing and non-PBC guess_bonds."""

from __future__ import annotations

from pathlib import Path

import MDAnalysis as mda
import numpy as np
import pytest

from app import (
    _add_bonds_from_pdb_link_records,
    _ensure_bonds_efficient,
    _guess_bonds_nonperiodic,
)


def _atom_line(
    serial: int,
    name: str,
    resname: str,
    chain: str,
    resid: int,
    x: float,
    y: float,
    z: float,
    element: str,
) -> str:
    # PDB ATOM columns: name 13-16, altLoc 17, resName 18-20, chain 22, resSeq 23-26.
    return (
        f"ATOM  {serial:5d} {name:<4s} {resname:>3s} {chain}{resid:4d}    "
        f"{x:8.3f}{y:8.3f}{z:8.3f}  1.00  0.00           {element:>2s}"
    )


def _link_line(
    name1: str,
    res1: str,
    chain1: str,
    resid1: int,
    name2: str,
    res2: str,
    chain2: str,
    resid2: int,
    dist: float,
) -> str:
    """Standard PDB LINK with correct column positions (no atom serials)."""
    line = [" "] * 80
    line[0:6] = list("LINK  ")
    line[12:16] = list(f"{name1:>4s}"[:4])
    line[17:20] = list(f"{res1:>3s}"[:3])
    line[21] = (chain1 or " ")[0]
    line[22:26] = list(f"{resid1:4d}")
    line[42:46] = list(f"{name2:>4s}"[:4])
    line[47:50] = list(f"{res2:>3s}"[:3])
    line[51] = (chain2 or " ")[0]
    line[52:56] = list(f"{resid2:4d}")
    line[73:78] = list(f"{dist:5.2f}")
    return "".join(line)


def test_link_misparse_style_does_not_create_long_bonds(tmp_path: Path):
    """6RV2-style LINK (THR O … K) must not bond by residue number-as-serial."""
    pdb = tmp_path / "link_metal.pdb"
    # Atom serials 1..4; residues 93 and 303 like 6RV2 coordination LINKs.
    lines = [
        "CRYST1   45.140  204.790  238.340  90.00  90.00  90.00 P 1           1",
        _atom_line(1, "O", "THR", "A", 93, 0.0, 0.0, 0.0, "O"),
        _atom_line(2, "CA", "THR", "A", 93, 1.5, 0.0, 0.0, "C"),
        _atom_line(3, "K", "K", "A", 303, 40.0, 0.0, 0.0, "K"),
        _atom_line(4, "K", "K", "A", 304, 42.0, 0.0, 0.0, "K"),
        _link_line("O", "THR", "A", 93, "K", "K", "A", 303, 2.68),
        _link_line("O", "THR", "A", 93, "K", "K", "A", 304, 2.90),
        "END",
    ]
    pdb.write_text("\n".join(lines) + "\n", encoding="utf-8")

    u = mda.Universe(str(pdb))
    try:
        _ = int(len(u.bonds))
    except Exception:
        pass

    added = _add_bonds_from_pdb_link_records(str(pdb), u)
    assert added == 0

    pos = u.atoms.positions
    long_bonds = 0
    try:
        for bond in u.bonds:
            i, j = bond.indices
            d = float(np.linalg.norm(pos[i] - pos[j]))
            if d > 5.0:
                long_bonds += 1
    except Exception:
        long_bonds = 0
    assert long_bonds == 0


def test_link_keeps_short_covalent_disulfide(tmp_path: Path):
    pdb = tmp_path / "link_ss.pdb"
    lines = [
        _atom_line(1, "SG", "CYS", "A", 10, 0.0, 0.0, 0.0, "S"),
        _atom_line(2, "SG", "CYS", "A", 20, 2.05, 0.0, 0.0, "S"),
        _atom_line(3, "CA", "CYS", "A", 10, -1.5, 0.0, 0.0, "C"),
        _atom_line(4, "CA", "CYS", "A", 20, 3.55, 0.0, 0.0, "C"),
        _link_line("SG", "CYS", "A", 10, "SG", "CYS", "A", 20, 2.05),
        "END",
    ]
    pdb.write_text("\n".join(lines) + "\n", encoding="utf-8")
    u = mda.Universe(str(pdb))
    added = _add_bonds_from_pdb_link_records(str(pdb), u)
    assert added == 1
    pairs = {(int(b.indices[0]), int(b.indices[1])) for b in u.bonds}
    pairs = {(a, b) if a < b else (b, a) for a, b in pairs}
    assert (0, 1) in pairs


def test_ensure_bonds_efficient_no_long_from_link(tmp_path: Path):
    pdb = tmp_path / "ensure.pdb"
    lines = [
        "CRYST1   45.140  204.790  238.340  90.00  90.00  90.00 P 1           1",
        _atom_line(1, "O", "THR", "A", 93, 0.0, 0.0, 0.0, "O"),
        _atom_line(2, "CA", "THR", "A", 93, 1.5, 0.0, 0.0, "C"),
        _atom_line(3, "C", "THR", "A", 93, 2.5, 0.8, 0.0, "C"),
        _atom_line(4, "N", "THR", "A", 93, -0.5, 1.0, 0.0, "N"),
        _atom_line(5, "K", "K", "A", 303, 40.0, 0.0, 0.0, "K"),
        _link_line("O", "THR", "A", 93, "K", "K", "A", 303, 2.68),
        "END",
    ]
    pdb.write_text("\n".join(lines) + "\n", encoding="utf-8")
    u = mda.Universe(str(pdb))
    _ensure_bonds_efficient(u, pdb_path=str(pdb))
    pos = u.atoms.positions
    for bond in u.bonds:
        i, j = bond.indices
        d = float(np.linalg.norm(pos[i] - pos[j]))
        assert d <= 5.0, f"spurious long bond {i}-{j} at {d:.2f} Å"


def test_guess_bonds_nonperiodic_ignores_cryst1_wrap(tmp_path: Path):
    """Atoms close across a tiny box must not bond when guessing without PBC."""
    pdb = tmp_path / "pbc.pdb"
    # Box 5 Å: atom at x=0 and x=4.8 are ~0.2 Å under MIC but 4.8 Å Cartesian.
    lines = [
        "CRYST1    5.000    5.000    5.000  90.00  90.00  90.00 P 1           1",
        _atom_line(1, "C1", "LIG", "A", 1, 0.0, 0.0, 0.0, "C"),
        _atom_line(2, "C2", "LIG", "A", 1, 4.8, 0.0, 0.0, "C"),
        "END",
    ]
    pdb.write_text("\n".join(lines) + "\n", encoding="utf-8")
    u = mda.Universe(str(pdb))
    assert u.dimensions is not None and float(u.dimensions[0]) == pytest.approx(5.0)
    _guess_bonds_nonperiodic(u.atoms)
    try:
        n = int(len(u.bonds))
    except Exception:
        n = 0
    assert n == 0
