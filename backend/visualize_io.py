"""Scratch PDBs for Visualize tools that need a single coordinate frame."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import MDAnalysis as mda

_TRAJECTORY_SUFFIXES = {".dcd", ".xtc", ".trr", ".nc", ".mdcrd"}


def open_universe(path: str, topology: str | None = None) -> mda.Universe:
    """Load a structure. Coordinate trajectories use frame 0 of *topology*."""
    src = Path(path)
    if not src.is_file():
        raise FileNotFoundError(f"Structure not found: {path}")
    top = None
    if topology:
        top = Path(os.path.abspath(os.path.expanduser(topology)))
        if not top.is_file():
            raise FileNotFoundError(f"Topology not found: {topology}")
    if src.suffix.lower() in _TRAJECTORY_SUFFIXES:
        if top is None:
            raise ValueError(
                f"{src.name} is a trajectory. Pass its topology so frame 0 can be written."
            )
        return mda.Universe(str(top), str(src))
    if top is not None and top.resolve() != src.resolve():
        return mda.Universe(str(top), str(src))
    return mda.Universe(str(src))


def scratch_pdb(path: str, topology: str | None = None) -> str:
    """Write the current frame (frame 0 for a trajectory) to a new temp PDB."""
    universe = open_universe(path, topology)
    fd, tmp_path = tempfile.mkstemp(suffix=".pdb")
    os.close(fd)
    universe.atoms.write(tmp_path)
    return tmp_path
