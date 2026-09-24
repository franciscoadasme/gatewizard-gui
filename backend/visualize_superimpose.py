"""Split one chain out of a structure, and superimpose one chain onto another.

Alignment is Biotite ``superimpose_homologs`` (BLOSUM62, Cα anchors, outlier
rejection). The rigid transform is applied to every atom of the mobile
structure. The reference is not written.
"""

from __future__ import annotations

import os
import tempfile

import biotite.sequence as seq
import biotite.sequence.align as align
import biotite.structure as struc
import numpy as np

from visualize_io import open_universe

_AA3_TO_1 = {
    "ALA": "A",
    "ARG": "R",
    "ASN": "N",
    "ASP": "D",
    "CYS": "C",
    "GLN": "Q",
    "GLU": "E",
    "GLY": "G",
    "HIS": "H",
    "ILE": "I",
    "LEU": "L",
    "LYS": "K",
    "MET": "M",
    "PHE": "F",
    "PRO": "P",
    "SER": "S",
    "THR": "T",
    "TRP": "W",
    "TYR": "Y",
    "VAL": "V",
}
_MIN_ANCHORS = 3


def _select_chain(universe, chain_id: str):
    cid = chain_id.strip()
    if not cid or any(ch in cid for ch in " '\"\\"):
        raise ValueError("Chain id is required")
    atoms = universe.select_atoms(f"chainID {cid}")
    if len(atoms) == 0:
        atoms = universe.select_atoms(f"segid {cid}")
    if len(atoms) == 0:
        raise ValueError(f"Chain {cid} not found")
    return atoms


def _write_pdb(atomgroup) -> str:
    fd, tmp_path = tempfile.mkstemp(suffix=".pdb")
    os.close(fd)
    atomgroup.write(tmp_path)
    return tmp_path


def split_chain(path: str, chain_id: str, topology: str | None = None) -> dict:
    """Write every atom of one chain (ligands and water included) to a PDB."""
    universe = open_universe(path, topology)
    atoms = _select_chain(universe, chain_id)
    out = _write_pdb(atoms)
    return {
        "path": out,
        "n_atoms": int(len(atoms)),
        "chain": chain_id.strip(),
    }


def _protein_array(atomgroup) -> struc.AtomArray:
    protein = atomgroup.select_atoms("protein")
    if len(protein) == 0:
        raise ValueError("That chain has no protein atoms to align")
    coords = np.asarray(protein.positions, dtype=np.float64)
    names = np.array([str(name).strip() for name in protein.names], dtype="U6")
    resnames = np.array([str(name).strip() for name in protein.resnames], dtype="U6")
    resids = np.asarray(protein.resids, dtype=np.int64)
    chains = np.array(
        [str(chain).strip() or "A" for chain in protein.chainIDs],
        dtype="U4",
    )
    elements = []
    for name in names:
        token = str(name).strip()
        elements.append(token[0].upper() if token else "C")
    array = struc.AtomArray(len(protein))
    array.coord = coords
    array.atom_name = names
    array.res_name = resnames
    array.res_id = resids
    array.chain_id = chains
    array.element = np.array(elements, dtype="U2")
    return array


def _ca_sequence(array: struc.AtomArray) -> seq.ProteinSequence:
    letters = []
    seen = set()
    for index in range(array.array_length()):
        if str(array.atom_name[index]).strip() != "CA":
            continue
        resname = str(array.res_name[index]).strip()
        letter = _AA3_TO_1.get(resname)
        if letter is None:
            continue
        key = (str(array.chain_id[index]).strip(), int(array.res_id[index]))
        if key in seen:
            continue
        seen.add(key)
        letters.append(letter)
    if len(letters) < _MIN_ANCHORS:
        raise ValueError(
            "Need at least 3 protein residues with a Cα on each chosen chain"
        )
    return seq.ProteinSequence("".join(letters))


def _positive_anchor_count(fixed: struc.AtomArray, mobile: struc.AtomArray) -> int:
    matrix = align.SubstitutionMatrix.std_protein_matrix()
    alignment = align.align_optimal(
        _ca_sequence(fixed),
        _ca_sequence(mobile),
        matrix,
        gap_penalty=-10,
        terminal_penalty=False,
    )[0]
    gapped = alignment.get_gapped_sequences()
    count = 0
    for left, right in zip(gapped[0], gapped[1]):
        if left == "-" or right == "-":
            continue
        if matrix.get_score(left, right) > 0:
            count += 1
    return count


def superimpose_structures(
    reference_path: str,
    reference_chain: str,
    mobile_path: str,
    mobile_chain: str,
    reference_topology: str | None = None,
    mobile_topology: str | None = None,
) -> dict:
    """Fit *mobile* onto *reference* and write a new PDB of the mobile structure.

    Raises if fewer than 3 sequence anchors match. The reference file is not
    modified.
    """
    reference = open_universe(reference_path, reference_topology)
    mobile = open_universe(mobile_path, mobile_topology)
    fixed_chain = _select_chain(reference, reference_chain)
    moving_chain = _select_chain(mobile, mobile_chain)
    fixed = _protein_array(fixed_chain)
    moving = _protein_array(moving_chain)
    anchors = _positive_anchor_count(fixed, moving)
    if anchors < _MIN_ANCHORS:
        raise ValueError(
            "Sequence homology is too low to superimpose "
            f"({anchors} positive-scoring anchor{'s' if anchors != 1 else ''}; need at least 3). "
            "Coordinates were not moved."
        )
    fitted, transform, fixed_idx, mobile_idx = struc.superimpose_homologs(
        fixed,
        moving,
        substitution_matrix="BLOSUM62",
        gap_penalty=-10,
        min_anchors=_MIN_ANCHORS,
    )
    n_anchors = int(len(fixed_idx))
    if n_anchors < _MIN_ANCHORS:
        raise ValueError(
            "Sequence homology is too low to superimpose "
            f"({n_anchors} anchors after outlier rejection). Coordinates were not moved."
        )
    mobile.atoms.positions = np.asarray(transform.apply(mobile.atoms.positions), dtype=np.float64)
    rmsd = float(struc.rmsd(fixed.coord[fixed_idx], fitted.coord[mobile_idx]))
    out = _write_pdb(mobile.atoms)
    return {
        "path": out,
        "n_atoms": int(len(mobile.atoms)),
        "n_anchors": n_anchors,
        "rmsd": rmsd,
    }
