"""Combine several structures into one PDB.

A shared chain id is kept when the pieces are different kinds of residue,
such as a protein and the ions that use that same chain letter. A merge is
refused when the same chain already contains that residue: the same residue
number within one component, or a second copy of the same protein or nucleic
sequence.
"""

from __future__ import annotations

import os
import tempfile

import MDAnalysis as mda

from visualize_io import open_universe

_PROTEIN = {
    "ALA", "ARG", "ASN", "ASP", "CYS", "GLN", "GLU", "GLY", "HIS", "ILE",
    "LEU", "LYS", "MET", "PHE", "PRO", "SER", "THR", "TRP", "TYR", "VAL",
    "HSD", "HSE", "HSP", "HID", "HIE", "HIP", "MSE",
}
_NUCLEIC = {
    "A", "C", "G", "U", "I",
    "DA", "DC", "DG", "DT", "DU",
    "RA", "RC", "RG", "RU",
    "ADE", "CYT", "GUA", "THY", "URA",
}
_WATER = {"HOH", "WAT", "H2O", "TIP", "TIP3", "TIP3P", "TIP4", "TIP4P", "SOL", "OPC"}
_ION_ELEMENTS = {
    "LI", "NA", "K", "RB", "CS", "MG", "CA", "SR", "BA", "MN", "FE", "CO",
    "NI", "CU", "ZN", "AG", "CD", "AU", "HG", "AL", "PB", "F", "CL", "BR", "I",
}


def _component(resname: str, element: str, n_atoms: int) -> str:
    name = resname.strip().upper()
    if name in _WATER:
        return "water"
    if name in _PROTEIN:
        return "protein"
    if name in _NUCLEIC:
        return "nucleic"
    token = element.strip().upper()
    if name in _ION_ELEMENTS or (n_atoms == 1 and token in _ION_ELEMENTS):
        return "ion"
    return "other"


def _residue_rows(universe):
    """Residues in file order, with the component used for duplicate checks."""
    rows = []
    for residue in universe.residues:
        atoms = residue.atoms
        chain = str(atoms[0].chainID or "").strip()
        resname = str(residue.resname).strip().upper()
        element = str(getattr(atoms[0], "element", "") or "")
        icode = str(getattr(residue, "icode", "") or "").strip()
        rows.append(
            {
                "chain": chain,
                "component": _component(resname, element, len(atoms)),
                "resname": resname,
                "resid": int(residue.resid),
                "icode": icode,
            }
        )
    return rows


def _duplicate_message(chain: str, component: str, detail: str) -> str:
    label = chain or "(blank)"
    return (
        f"Chain {label} already has this {component} ({detail}). "
        "Remove that copy, or renumber it, before merging."
    )


def merge_structures(paths: list[str]) -> dict:
    """Write one PDB containing every atom of each path, in the given order."""
    if len(paths) < 2:
        raise ValueError("Select at least two structures to merge")
    missing = [path for path in paths if not os.path.isfile(path)]
    if missing:
        raise FileNotFoundError(f"Structure not found: {missing[0]}")
    universes = [open_universe(path) for path in paths]
    if any(len(universe.atoms) == 0 for universe in universes):
        raise ValueError("One of the structures has no atoms")

    # (chain, component, resid, icode) -> resname
    slots: dict[tuple, str] = {}
    # (chain, component) -> sequences already accepted, for polymer copies
    sequences: dict[tuple, set[tuple]] = {}
    chains: list[str] = []
    seen_chains: set[str] = set()

    for universe in universes:
        grouped: dict[tuple, list[dict]] = {}
        for row in _residue_rows(universe):
            grouped.setdefault((row["chain"], row["component"]), []).append(row)
            if row["chain"] not in seen_chains:
                seen_chains.add(row["chain"])
                chains.append(row["chain"])
        for key, group in grouped.items():
            chain, component = key
            for row in group:
                slot = (chain, component, row["resid"], row["icode"])
                if slot in slots:
                    raise ValueError(
                        _duplicate_message(
                            chain,
                            component,
                            f"{row['resname']} {row['resid']}",
                        )
                    )
            if component in {"protein", "nucleic"}:
                sequence = tuple(row["resname"] for row in group)
                if sequence and sequence in sequences.get(key, set()):
                    raise ValueError(
                        _duplicate_message(
                            chain,
                            component,
                            f"the same {len(sequence)} residues",
                        )
                    )
            for row in group:
                slots[(chain, component, row["resid"], row["icode"])] = row["resname"]
            if component in {"protein", "nucleic"}:
                sequence = tuple(row["resname"] for row in group)
                if sequence:
                    sequences.setdefault(key, set()).add(sequence)

    merged = mda.Merge(*(universe.atoms for universe in universes))
    fd, tmp_path = tempfile.mkstemp(suffix=".pdb")
    os.close(fd)
    merged.atoms.write(tmp_path)
    return {
        "path": tmp_path,
        "n_atoms": int(len(merged.atoms)),
        "chains": [chain for chain in chains if chain],
    }
