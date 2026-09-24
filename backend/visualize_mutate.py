"""Dunbrack rotamer preview and apply for the Visualize mutator.

Scoring follows pyMUT's heavy-atom van der Waals loop, but each rotamer is
built from a fresh copy of the backbone-fitted sample. pyMUT's
``select_best_rotamer_based_on_clashes`` updates the sample in place, so later
rotamers start from the previous χ and the reported best placement is not an
independent minimum. This module does not replicate that.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

import numpy as np
from Bio.PDB import PDBIO, PDBParser, Polypeptide
from Bio.PDB.Atom import Atom
from Bio.PDB.NeighborSearch import NeighborSearch
from Bio.SVDSuperimposer import SVDSuperimposer

_VENDOR = Path(__file__).resolve().parent / "vendor" / "pymut"
if str(_VENDOR) not in sys.path:
    sys.path.insert(0, str(_VENDOR))

import pymut  # noqa: E402

# NumPy 2 removed np.mat. pyMUT's mutate() still calls it; the GUI env is NumPy 2.
if not hasattr(pymut.np, "mat"):
    pymut.np.mat = pymut.np.asmatrix

_LIB_PATH = _VENDOR / "data" / "rotamers.lib"
_ROTAMERS: dict | None = None

STANDARD_AA = (
    "ALA",
    "ARG",
    "ASN",
    "ASP",
    "CYS",
    "GLN",
    "GLU",
    "GLY",
    "HIS",
    "ILE",
    "LEU",
    "LYS",
    "MET",
    "PHE",
    "PRO",
    "SER",
    "THR",
    "TRP",
    "TYR",
    "VAL",
)
_BACKBONE = ("N", "CA", "C", "O")
_CHI_NAMES = ("CHI1", "CHI2", "CHI3", "CHI4")


def load_rotamer_library() -> dict:
    """Load pyMUT's full Dunbrack ``rotamers.lib`` once and cache it."""
    global _ROTAMERS
    if _ROTAMERS is not None:
        return _ROTAMERS
    if not _LIB_PATH.is_file():
        raise FileNotFoundError(f"Rotamer library missing: {_LIB_PATH}")
    _ROTAMERS = pymut.load_rotamers(str(_LIB_PATH))
    return _ROTAMERS


def _is_hydrogen(name: str) -> bool:
    token = name.strip().upper()
    if not token:
        return False
    if token[0] != "H":
        return False
    return len(token) == 1 or token[1].isdigit()


def _residue(structure, chain_id: str, resnum: int):
    try:
        chain = structure[0][chain_id]
    except KeyError as exc:
        raise ValueError(f"Chain {chain_id} not found") from exc
    key = (" ", int(resnum), " ")
    if key in chain:
        return chain[key]
    for residue in chain:
        if residue.id[0] == " " and int(residue.id[1]) == int(resnum):
            return residue
    raise ValueError(f"Residue {resnum} not found in chain {chain_id}")


def _require_backbone(residue) -> None:
    missing = [name for name in _BACKBONE if name not in residue]
    if missing:
        raise ValueError(
            "Residue is missing backbone atoms "
            + ", ".join(missing)
            + ". The mutator needs N, CA, C, and O."
        )


def _phi_psi(structure, chain_id: str, residue) -> tuple[int, int]:
    Polypeptide.Polypeptide(structure[0][chain_id]).get_phi_psi_list()

    def _round(angle) -> int:
        if angle is None:
            return 0
        return int(round(float(np.rad2deg(angle)), -1))

    phi = residue.xtra.get("PHI") if hasattr(residue, "xtra") else None
    psi = residue.xtra.get("PSI") if hasattr(residue, "xtra") else None
    return _round(phi), _round(psi)


def _lookup_rotamers(lib: dict, resname: str, phi: int, psi: int):
    table = lib.get(resname) or {}
    exact = table.get(phi, {}).get(psi)
    if exact:
        return exact, phi, psi
    best = None
    best_d = None
    for phi_bin, row in table.items():
        for psi_bin, rots in row.items():
            if not rots:
                continue
            dist = (int(phi_bin) - phi) ** 2 + (int(psi_bin) - psi) ** 2
            if best_d is None or dist < best_d:
                best_d = dist
                best = (rots, int(phi_bin), int(psi_bin))
    if best is None:
        raise ValueError(f"No rotamers for {resname} near φ={phi} ψ={psi}")
    return best


def _fit_sample(sample: dict, residue) -> dict:
    coords = {name: np.array(vec, dtype=float) for name, vec in sample.items()}
    sup = SVDSuperimposer()
    sup.set(
        np.vstack([residue["N"].coord, residue["CA"].coord, residue["C"].coord]),
        np.vstack([coords["N"], coords["CA"], coords["C"]]),
    )
    sup.run()
    rot, tran = sup.get_rotran()
    for name, vec in coords.items():
        coords[name] = np.squeeze(np.asarray(np.dot(vec, rot) + tran))
    return coords


def _apply_chi(coords: dict, mutate_to: str, rotamer: dict | None) -> dict:
    if rotamer is None:
        return coords
    for angle in _CHI_NAMES:
        if mutate_to not in pymut.CHI_ANGLES[angle]:
            continue
        plane = pymut.CHI_ANGLES[angle][mutate_to]["ref_plane"]
        dihedral_start = pymut.dihedral_from_vectors(*[coords[name] for name in plane])
        rotation_angle = dihedral_start - np.deg2rad(float(rotamer[angle]))
        axis = pymut.CHI_ANGLES[angle][mutate_to]["axis"]
        origin = coords[axis[1]]
        direction = coords[axis[0]] - origin
        matrix = pymut.rotation_matrix(direction, rotation_angle)
        start = pymut.RESIDUE_ORDER[mutate_to].index(axis[1]) + 1
        for atom_name in pymut.RESIDUE_ORDER[mutate_to][start:]:
            coords[atom_name] = np.dot(matrix, coords[atom_name] - origin) + origin
    return coords


def _vdw(structure, chain_id: str, resnum: int, mutate_to: str, coords: dict) -> float:
    atoms = list(structure.get_atoms())
    search = NeighborSearch(atoms)
    energy = 0.0
    for name, vec in coords.items():
        if _is_hydrogen(name):
            continue
        for close in search.search(np.asarray(vec, dtype=float), 5.0):
            parent = close.get_parent()
            parent_chain = parent.get_parent()
            if int(parent.id[1]) == int(resnum) and parent_chain.id == chain_id:
                continue
            if abs(int(parent.id[1]) - int(resnum)) == 1 and pymut.is_backbone(close):
                continue
            dist = float(pymut.distance(close.coord, vec))
            if dist > 6.0 or dist < 1e-6:
                continue
            try:
                radii = (
                    pymut.VW_RADII[parent.get_resname()][close.get_id()]
                    + pymut.VW_RADII[mutate_to][name]
                )
            except KeyError:
                continue
            attractive = (radii / dist) ** 6
            energy += attractive**2 - attractive
    return float(energy)


def _element_of(name: str) -> str:
    token = name.strip()
    if len(token) >= 2 and token[0].isalpha() and token[1].islower():
        return token[:2]
    return token[0].upper() if token else "C"


def _preview_atoms(residue, placed: dict) -> list[dict]:
    atoms = []
    for name in _BACKBONE:
        coord = residue[name].coord
        atoms.append(
            {
                "name": name,
                "element": _element_of(name),
                "x": float(coord[0]),
                "y": float(coord[1]),
                "z": float(coord[2]),
            }
        )
    for name, coord in placed.items():
        if name in _BACKBONE or _is_hydrogen(name):
            continue
        atoms.append(
            {
                "name": name,
                "element": _element_of(name),
                "x": float(coord[0]),
                "y": float(coord[1]),
                "z": float(coord[2]),
            }
        )
    return atoms


def _chi_values(resname: str, rotamer: dict | None) -> list[float]:
    if rotamer is None:
        return []
    values = []
    for angle in _CHI_NAMES:
        if resname in pymut.CHI_ANGLES[angle]:
            values.append(float(rotamer[angle]))
    return values


def _candidates(pdb_path: str, chain_id: str, resnum: int, mutate_to: str):
    target = mutate_to.strip().upper()
    if target not in STANDARD_AA:
        raise ValueError(f"{mutate_to} is not one of the 20 standard amino acids")
    chain = chain_id.strip()
    if not chain:
        raise ValueError("Chain id is required")
    parser = PDBParser(QUIET=True)
    structure = parser.get_structure("mut", pdb_path)
    residue = _residue(structure, chain, int(resnum))
    _require_backbone(residue)
    phi, psi = _phi_psi(structure, chain, residue)
    sample = _fit_sample(pymut.read_sample_residue(target), residue)
    if target in ("ALA", "GLY"):
        raw = [(None, 1.0)]
        used_phi, used_psi = phi, psi
    else:
        rotamers, used_phi, used_psi = _lookup_rotamers(
            load_rotamer_library(), target, phi, psi
        )
        raw = [(rot, float(rot["prob"])) for rot in rotamers]
        if not raw:
            raise ValueError(f"No rotamers for {target}")
    rows = []
    for rotamer, prob in raw:
        placed = _apply_chi(
            {name: np.array(vec, dtype=float) for name, vec in sample.items()},
            target,
            rotamer,
        )
        rows.append(
            {
                "prob": float(prob),
                "vdw": _vdw(structure, chain, int(resnum), target, placed),
                "chi": _chi_values(target, rotamer),
                "atoms": _preview_atoms(residue, placed),
                "_placed": placed,
            }
        )
    rows.sort(key=lambda row: (row["vdw"], -row["prob"]))
    for index, row in enumerate(rows):
        row["index"] = index
        row["best"] = index == 0
    return {
        "structure": structure,
        "residue": residue,
        "phi": phi,
        "psi": psi,
        "bin_phi": used_phi,
        "bin_psi": used_psi,
        "mutate_to": target,
        "chain": chain,
        "resnum": int(resnum),
        "rows": rows,
    }


def list_rotamers(pdb_path: str, chain_id: str, resnum: int, mutate_to: str) -> dict:
    """Return rotamers and side-chain coordinates. Does not write a file."""
    built = _candidates(pdb_path, chain_id, resnum, mutate_to)
    rotamers = []
    for row in built["rows"]:
        rotamers.append(
            {
                "index": row["index"],
                "prob": row["prob"],
                "vdw": row["vdw"],
                "chi": row["chi"],
                "atoms": row["atoms"],
                "best": row["best"],
            }
        )
    return {
        "phi": built["phi"],
        "psi": built["psi"],
        "bin_phi": built["bin_phi"],
        "bin_psi": built["bin_psi"],
        "mutate_to": built["mutate_to"],
        "rotamers": rotamers,
    }


def _write_mutation(structure, residue, mutate_to: str, placed: dict) -> str:
    for atom in list(residue.get_atoms()):
        if not pymut.is_backbone(atom):
            residue.detach_child(atom.id)
    serial = 1 + max((atom.serial_number or 0) for atom in structure.get_atoms())
    for name, coord in placed.items():
        if name in _BACKBONE or _is_hydrogen(name):
            continue
        residue.add(
            Atom(
                name,
                np.asarray(coord, dtype=float),
                1.0,
                1.0,
                " ",
                f"{name:>4}"[-4:],
                serial,
                _element_of(name),
            )
        )
        serial += 1
    residue.resname = mutate_to
    fd, tmp_path = tempfile.mkstemp(suffix=".pdb")
    os.close(fd)
    writer = PDBIO()
    writer.set_structure(structure)
    writer.save(tmp_path)
    return tmp_path


def apply_mutation(
    pdb_path: str, chain_id: str, resnum: int, mutate_to: str, rotamer_index: int
) -> dict:
    """Write the chosen rotamer to a new PDB. The backbone is not moved."""
    built = _candidates(pdb_path, chain_id, resnum, mutate_to)
    rows = built["rows"]
    if rotamer_index < 0 or rotamer_index >= len(rows):
        raise ValueError(f"Rotamer index {rotamer_index} is out of range")
    path = _write_mutation(
        built["structure"],
        built["residue"],
        built["mutate_to"],
        rows[rotamer_index]["_placed"],
    )
    n_atoms = sum(1 for _ in built["structure"].get_atoms())
    return {"path": path, "n_atoms": int(n_atoms), "rotamer_index": int(rotamer_index)}
