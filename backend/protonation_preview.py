"""Best-effort protonation geometry preview (ghost H) for the Preparation viewer.

Places ideal sidechain hydrogens for Amber-style residue names without running
pdb4amber. Geometry is approximate and intended for visual preview only.
"""

from __future__ import annotations

import math
from typing import Any

# Ideal sidechain protons for Amber residue names: (H name, parent heavy atom).
_STATE_PROTONS: dict[str, list[tuple[str, str]]] = {
    "ASP": [],
    "ASH": [("HD2", "OD2")],
    "GLU": [],
    "GLH": [("HE2", "OE2")],
    "HIS": [("HE2", "NE2")],  # treat unresolved HIS like HIE
    "HIE": [("HE2", "NE2")],
    "HID": [("HD1", "ND1")],
    "HIP": [("HD1", "ND1"), ("HE2", "NE2")],
    "LYS": [("HZ1", "NZ"), ("HZ2", "NZ"), ("HZ3", "NZ")],
    "LYN": [("HZ1", "NZ"), ("HZ2", "NZ")],
    "CYS": [("HG", "SG")],
    "CYM": [],
    "TYR": [("HH", "OH")],
    "SER": [("HG", "OG")],
    "THR": [("HG1", "OG1")],
}

_BOND_LEN = 1.0


def _vec_sub(a: tuple[float, float, float], b: tuple[float, float, float]) -> tuple[float, float, float]:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _vec_add(a: tuple[float, float, float], b: tuple[float, float, float]) -> tuple[float, float, float]:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _vec_scale(a: tuple[float, float, float], s: float) -> tuple[float, float, float]:
    return (a[0] * s, a[1] * s, a[2] * s)


def _vec_len(a: tuple[float, float, float]) -> float:
    return math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])


def _vec_norm(a: tuple[float, float, float]) -> tuple[float, float, float]:
    L = _vec_len(a)
    if L < 1e-8:
        return (0.0, 0.0, 1.0)
    return (a[0] / L, a[1] / L, a[2] / L)


def _place_h_away_from_neighbors(
    parent: tuple[float, float, float],
    neighbors: list[tuple[float, float, float]],
    bond_length: float = _BOND_LEN,
) -> tuple[float, float, float]:
    """Place H along the direction opposite the average neighbor direction."""
    if not neighbors:
        return (parent[0], parent[1], parent[2] + bond_length)
    acc = (0.0, 0.0, 0.0)
    for n in neighbors:
        d = _vec_norm(_vec_sub(n, parent))
        acc = _vec_add(acc, d)
    # Away from the average neighbor direction
    direction = _vec_norm(_vec_scale(acc, -1.0))
    if _vec_len(acc) < 1e-8:
        direction = (0.0, 0.0, 1.0)
    return _vec_add(parent, _vec_scale(direction, bond_length))


def _place_multi_h_on_terminal(
    parent: tuple[float, float, float],
    anchor: tuple[float, float, float] | None,
    count: int,
    bond_length: float = _BOND_LEN,
) -> list[tuple[float, float, float]]:
    """Tetrahedral-ish placement for NZ (LYS) / similar terminal atoms."""
    if count <= 0:
        return []
    axis = _vec_norm(_vec_sub(parent, anchor)) if anchor is not None else (0.0, 0.0, 1.0)
    # Build orthonormal basis
    tmp = (1.0, 0.0, 0.0) if abs(axis[0]) < 0.9 else (0.0, 1.0, 0.0)
    ux = _vec_norm(
        (
            axis[1] * tmp[2] - axis[2] * tmp[1],
            axis[2] * tmp[0] - axis[0] * tmp[2],
            axis[0] * tmp[1] - axis[1] * tmp[0],
        )
    )
    uy = (
        axis[1] * ux[2] - axis[2] * ux[1],
        axis[2] * ux[0] - axis[0] * ux[2],
        axis[0] * ux[1] - axis[1] * ux[0],
    )
    # ~tetrahedral angle from -axis for methyl-like/ammonium
    tilt = math.radians(70.5)
    out: list[tuple[float, float, float]] = []
    for i in range(count):
        ang = (2.0 * math.pi * i) / count + (0.0 if count != 3 else math.radians(10))
        dir_vec = _vec_norm(
            _vec_add(
                _vec_add(
                    _vec_scale(axis, -math.cos(tilt)),
                    _vec_scale(ux, math.sin(tilt) * math.cos(ang)),
                ),
                _vec_scale(uy, math.sin(tilt) * math.sin(ang)),
            )
        )
        out.append(_vec_add(parent, _vec_scale(dir_vec, bond_length)))
    return out


def _parse_atom_line(line: str) -> dict[str, Any] | None:
    if not line.startswith(("ATOM", "HETATM")) or len(line) < 54:
        return None
    try:
        return {
            "name": line[12:16].strip(),
            "res_name": line[17:20].strip(),
            "chain": line[21:22].strip(),
            "res_id": int(line[22:26]),
            "x": float(line[30:38]),
            "y": float(line[38:46]),
            "z": float(line[46:54]),
            "element": (line[76:78].strip() if len(line) >= 78 else line[12:16].strip()[0]).upper()
            or "C",
        }
    except ValueError:
        return None


def _residue_atoms_from_pdb(
    pdb_path: str, chain: str, res_id: int
) -> list[dict[str, Any]]:
    atoms: list[dict[str, Any]] = []
    with open(pdb_path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            atom = _parse_atom_line(line)
            if not atom:
                continue
            if atom["res_id"] == int(res_id) and (atom["chain"] or "") == (chain or ""):
                atoms.append(atom)
    return atoms


def _by_name(atoms: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {a["name"]: a for a in atoms}


def _neighbor_positions(
    parent_name: str, by_name: dict[str, dict[str, Any]], exclude: set[str] | None = None
) -> list[tuple[float, float, float]]:
    exclude = exclude or set()
    parent = by_name.get(parent_name)
    if not parent:
        return []
    px = (parent["x"], parent["y"], parent["z"])
    out: list[tuple[float, float, float]] = []
    for name, atom in by_name.items():
        if name == parent_name or name in exclude:
            continue
        if atom.get("element", "").upper() == "H" or name.startswith("H"):
            continue
        pos = (atom["x"], atom["y"], atom["z"])
        if _vec_len(_vec_sub(pos, px)) < 2.0:
            out.append(pos)
    return out


def _protons_for_state(state: str) -> list[tuple[str, str]]:
    return list(_STATE_PROTONS.get(str(state).upper().strip(), []))


def preview_residue_protonation(
    pdb_path: str,
    *,
    chain: str,
    res_id: int,
    initial_state: str,
    current_state: str,
    ghost_index_base: int = -1,
) -> dict[str, list[dict[str, Any]]]:
    """Return ghost (added) and removed-marker atoms for one residue state change."""
    init = str(initial_state).upper().strip()
    curr = str(current_state).upper().strip()
    if init == curr:
        return {"ghost_atoms": [], "removed_markers": []}

    atoms = _residue_atoms_from_pdb(pdb_path, chain, int(res_id))
    if not atoms:
        return {"ghost_atoms": [], "removed_markers": []}

    by_name = _by_name(atoms)
    init_p = {name: parent for name, parent in _protons_for_state(init)}
    curr_p = {name: parent for name, parent in _protons_for_state(curr)}

    to_add = [(n, p) for n, p in curr_p.items() if n not in init_p]
    to_remove = [(n, p) for n, p in init_p.items() if n not in curr_p]

    ghost_atoms: list[dict[str, Any]] = []
    removed_markers: list[dict[str, Any]] = []
    idx = ghost_index_base

    # Group NZ multi-H for LYS/LYN differences
    def emit_h(h_name: str, parent_name: str, role: str) -> None:
        nonlocal idx
        parent = by_name.get(parent_name)
        if not parent:
            return
        # Prefer existing H coordinates for removals
        if role == "remove" and h_name in by_name:
            h = by_name[h_name]
            idx -= 1
            removed_markers.append(
                {
                    "x": h["x"],
                    "y": h["y"],
                    "z": h["z"],
                    "element": "H",
                    "name": h_name,
                    "index": idx,
                    "res_name": curr,
                    "res_id": int(res_id),
                    "chain_id": chain or "",
                    "role": "remove",
                }
            )
            return

        parent_pos = (parent["x"], parent["y"], parent["z"])
        if parent_name == "NZ":
            # Place relative to CE when placing a single extra/missing NZ proton
            ce = by_name.get("CE")
            anchor = (ce["x"], ce["y"], ce["z"]) if ce else None
            # Distinct phase for HZ1/2/3
            order = {"HZ1": 0, "HZ2": 1, "HZ3": 2}.get(h_name, 0)
            positions = _place_multi_h_on_terminal(parent_pos, anchor, 3)
            pos = positions[order] if order < len(positions) else positions[0]
        else:
            neighbors = _neighbor_positions(parent_name, by_name, exclude={h_name})
            pos = _place_h_away_from_neighbors(parent_pos, neighbors)

        idx -= 1
        entry = {
            "x": pos[0],
            "y": pos[1],
            "z": pos[2],
            "element": "H",
            "name": h_name,
            "index": idx,
            "res_name": curr if role == "add" else init,
            "res_id": int(res_id),
            "chain_id": chain or "",
            "role": role,
        }
        if role == "add":
            ghost_atoms.append(entry)
        else:
            removed_markers.append(entry)

    for h_name, parent in to_add:
        emit_h(h_name, parent, "add")
    for h_name, parent in to_remove:
        emit_h(h_name, parent, "remove")

    return {"ghost_atoms": ghost_atoms, "removed_markers": removed_markers}


def preview_protonation_geometry(
    pdb_path: str, residues: list[dict[str, Any]]
) -> dict[str, list[dict[str, Any]]]:
    """Preview ghost H for all residue state changes in ``residues``."""
    ghost_atoms: list[dict[str, Any]] = []
    removed_markers: list[dict[str, Any]] = []
    base = -1
    for res in residues:
        init = res.get("initial_state") or res.get("residue")
        curr = res.get("current_state") or init
        if str(init).upper() == str(curr).upper():
            continue
        out = preview_residue_protonation(
            pdb_path,
            chain=str(res.get("chain") or ""),
            res_id=int(res["res_id"]),
            initial_state=str(init),
            current_state=str(curr),
            ghost_index_base=base,
        )
        ghost_atoms.extend(out["ghost_atoms"])
        removed_markers.extend(out["removed_markers"])
        base -= max(len(out["ghost_atoms"]) + len(out["removed_markers"]), 1) + 1
    return {"ghost_atoms": ghost_atoms, "removed_markers": removed_markers}
