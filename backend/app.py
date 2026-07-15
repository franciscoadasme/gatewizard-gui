"""HTTP API for the GateWizard desktop app (spawned by Electron main process)."""

import base64
import json
import os
import re
import requests
import shutil
import signal
import subprocess
import sys
import threading
import tempfile
import uuid
from collections import deque
from dataclasses import dataclass
from importlib import metadata
from pathlib import Path
from typing import Any, List

# Ensure CONDA_PREFIX/bin is on PATH (safety net for late-installed tools)
# Also set AMBERHOME so packmol-memgen can discover packmol/tleap/etc.
_conda_prefix = os.environ.get("CONDA_PREFIX", "")
if _conda_prefix:
    _bin_dir = os.path.join(_conda_prefix, "bin")
    _path = os.environ.get("PATH", "")
    if _bin_dir not in _path.split(os.pathsep):
        os.environ["PATH"] = f"{_bin_dir}{os.pathsep}{_path}"
    if not os.environ.get("AMBERHOME"):
        os.environ["AMBERHOME"] = _conda_prefix

import numpy as np
import MDAnalysis as mda
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from gatewizard.utils.protein_capping import (
    cap_protein,
    detect_terminal_caps,
)
from gatewizard.utils.helpers import resolve_pdb_chain_id
from gatewizard.utils.logger import get_logger
from gatewizard.core.structure_manager import (
    StructureManager,
    StructureError,
    assign_secondary_structure_map,
)
from gatewizard.core.mempro import MemProError
from gatewizard.core.preparation import (
    PreparationError,
    PreparationManager,
    count_protein_hydrogens,
    strip_protein_hydrogens,
)
from gatewizard.core.builder import Builder

logger = get_logger(__name__)

try:
    from gatewizard.tools.equilibration import (
        NAMDEquilibrationManager,
        GROMACSEquilibrationManager,
        OpenMMEquilibrationManager,
    )
except ImportError:
    from gatewizard.tools.equilibration import NAMDEquilibrationManager

    GROMACSEquilibrationManager = None
    OpenMMEquilibrationManager = None
from gatewizard.tools.force_fields import ForceFieldManager
from gatewizard.tools.ligand_parametrization import (
    detect_ligands,
    parametrize_ligand_from_system_pdb,
    get_ligand_2d_image,
    get_ligand_2d_image_from_pdb_lines,
)
from gatewizard.utils import namd_analysis
from gatewizard.utils import gromacs_analysis
from gatewizard.utils import openmm_analysis
from gatewizard.utils.optional_deps import get_dependency_versions, list_md_engine_candidates

ION_NAMES = [
    "NA",
    "CL",
    "K",
    "MG",
    "ZN",
    "CA",
    "MN",
    "FE",
    "FE2",
    "FE3",
    "CU",
    "CU1",
    "CU2",
    "NI",
    "CD",
    "HG",
    "CS",
    "RB",
    "SR",
    "BA",
    "I",
    "BR",
    "F",
    "LI",
    "AL",
    "CR",
    "AG",
    "AU",
    "PB",
    "SOD",
    "POT",
    "CLA",
    "CAL",
    "CES",
    "BAR",
    "LIT",
    "RUB",
    "ZN2",
    "NH4",
]
ION_SELECTION = "resname " + " ".join(ION_NAMES)
LIPID_NAMES = [
    "DPPC",
    "DMPC",
    "DLPC",
    "DOPC",
    "POPC",
    "DSPC",
    "PLPC",
    "PLPE",
    "PLPA",
    "DOPE",
    "POPE",
    "PIPE",
    "DLPE",
    "DPPE",
    "DOPS",
    "POPS",
    "POPG",
    "DOPG",
    "POPA",
    "DOPA",
    "POPI",
    "PIPC",
    "PSPC",
    "PGPC",
    "PGPE",
    "LPC",
    "LPE",
    "LPG",
    "CDL2",
    "CARD",
    "CLP1",
    "CHL1",
    "CHOL",
    "CLOL",
    "ERG",
    "SAPI",
    "SM",
    "BSM",
    "SPM",
    "CHLM",
]
LIPID_SELECTION = "resname " + " ".join(LIPID_NAMES)
NAMED_SELECTIONS = {
    "all": "all",
    "protein": "protein",
    "backbone": "backbone",
    "sidechain": "protein and not backbone",
    "water": "water",
    "lipid": LIPID_SELECTION,
    "ion": ION_SELECTION,
    "ligand": f"not (protein or nucleic or water or ({ION_SELECTION}) or ({LIPID_SELECTION}))",
}


@dataclass
class FileCacheEntry:
    mtime: int
    size: int
    universe: mda.Universe
    bond_guessed: bool = False


FILE_CACHE: dict[str, FileCacheEntry] = {}
FILE_CACHE_LOCK = threading.Lock()


def _ensure_elements(atoms: mda.AtomGroup) -> None:
    """Add guessed element topology attribute if the universe lacks it."""
    try:
        atoms[0].element
    except (mda.exceptions.NoDataError, IndexError):
        from MDAnalysis.topology.guessers import guess_atom_element

        els = [guess_atom_element(n) for n in atoms.universe.atoms.names]
        atoms.universe.add_TopologyAttr("elements", els)


def get_atoms(atoms: mda.AtomGroup | mda.Universe) -> list[dict]:
    if isinstance(atoms, mda.Universe):
        atoms = atoms.atoms
    _ensure_elements(atoms)
    return [
        dict(
            x=float(it.position[0]),
            y=float(it.position[1]),
            z=float(it.position[2]),
            element=str(it.element),
            name=str(it.name).strip(),
            index=int(it.index),
            res_name=str(it.resname).strip(),
            res_id=int(it.resid),
            chain_id=resolve_pdb_chain_id(
                str(it.segid),
                str(getattr(it, "chainID", "") or ""),
            ),
        )
        for it in atoms
    ]


def get_residues(
    u: mda.Universe,
    needs_secondary_structure: bool = False,
    source_path: str | None = None,
) -> list[dict]:
    residue_sec_table: dict[tuple[str, int, str | None], str] = {}
    resid_unique: dict[int, str] = {}
    resid_ambiguous: set[int] = set()
    if needs_secondary_structure:
        pdb_for_ss = source_path
        cleanup = False
        if not pdb_for_ss or not os.path.isfile(pdb_for_ss):
            tmp = tempfile.NamedTemporaryFile("w", suffix=".pdb", delete=False)
            u.atoms.write(tmp.name)
            tmp.close()
            pdb_for_ss = tmp.name
            cleanup = True
        try:
            # auto: PSIQUE first, then PDB HELIX/SHEET records, then CA-angle heuristic
            ss_map = assign_secondary_structure_map(pdb_for_ss, method="auto")
            resid_unique: dict[int, str] = {}
            resid_ambiguous: set[int] = set()
            for (chain, resid), sec in ss_map.items():
                residue_sec_table[(chain, resid, None)] = sec
                rid = int(resid)
                if rid in resid_unique and resid_unique[rid] != sec:
                    resid_ambiguous.add(rid)
                elif rid not in resid_ambiguous:
                    resid_unique[rid] = sec
        except Exception as exc:
            logger.warning("Secondary structure assignment failed: %s", exc)
            resid_unique = {}
            resid_ambiguous = set()
        finally:
            if cleanup and pdb_for_ss:
                try:
                    os.unlink(pdb_for_ss)
                except OSError:
                    pass

    residues = []
    for res in u.residues:
        try:
            chain_id_attr = str(res.atoms[0].chainID or "")
        except (AttributeError, IndexError):
            chain_id_attr = ""
        chain = resolve_pdb_chain_id(str(res.segid), chain_id_attr)
        ca_atoms = res.atoms.select_atoms("name CA")
        rid = int(res.resid)
        sec = residue_sec_table.get((chain, rid, None))
        if sec is None and rid not in resid_ambiguous:
            sec = resid_unique.get(rid)
        residues.append(
            dict(
                chain=chain,
                resname=str(res.resname).strip(),
                number=int(res.resid),
                atom_indices=sorted(int(i) for i in res.atoms.indices.tolist()),
                sec=sec,
                ca_index=(int(ca_atoms.indices[0]) if ca_atoms.n_atoms == 1 else None),
            )
        )
    return residues


_TOPOLOGY_ONLY_SUFFIXES = frozenset(
    {".psf", ".prmtop", ".parm7", ".top", ".itp"}
)
_COORDINATE_TRAJECTORY_SUFFIXES = frozenset(
    {".dcd", ".xtc", ".trr", ".nc", ".mdcrd", ".crd", ".inpcrd", ".dtr", ".lammpstrj", ".h5md"}
)


def _is_topology_only_file(path: Path) -> bool:
    return path.suffix.lower() in _TOPOLOGY_ONLY_SUFFIXES


def _is_coordinate_trajectory_file(path: Path) -> bool:
    ext = path.suffix.lower()
    if ext in _COORDINATE_TRAJECTORY_SUFFIXES:
        return True
    if ext in _TOPOLOGY_ONLY_SUFFIXES:
        return False
    return True


def _filter_coordinate_trajectories(
    topology: Path, trajectories: list[Path]
) -> list[Path]:
    """Drop topology files accidentally listed as trajectories."""
    top_resolved = topology.resolve()
    filtered: list[Path] = []
    for traj in trajectories:
        traj_resolved = traj.resolve()
        if traj_resolved == top_resolved:
            continue
        if _is_topology_only_file(traj):
            continue
        filtered.append(traj)
    return filtered


def _load_analysis_universe(topology: Path, trajectories: list[Path]) -> mda.Universe:
    """Load topology + coordinate trajectory the same way MDAnalysis expects."""
    coord_trajs = _filter_coordinate_trajectories(topology, trajectories)
    if not coord_trajs:
        traj_names = ", ".join(t.name for t in trajectories)
        raise ValueError(
            f"No coordinate trajectory found among: {traj_names}. "
            f"Files like {topology.name!r} are topology only — add DCD, XTC, TRR, "
            "NC, or similar trajectory files."
        )
    top_str = str(topology.resolve())
    if len(coord_trajs) == 1:
        return mda.Universe(top_str, str(coord_trajs[0]))
    return mda.Universe(top_str, [str(t) for t in coord_trajs])


def _companion_coordinate_file(topology: Path) -> Path | None:
    """Find a coordinate file next to the topology (AMBER inpcrd, PDB, etc.)."""
    directory = topology.parent
    stem = topology.stem.lower()
    preferred_names = (
        topology.name.replace(topology.suffix, ".inpcrd"),
        topology.name.replace(topology.suffix, ".rst7"),
        topology.name.replace(topology.suffix, ".pdb"),
        "system.inpcrd",
        "system.rst7",
        "system.pdb",
    )
    for name in preferred_names:
        candidate = directory / name
        if candidate.is_file() and not _is_topology_only_file(candidate):
            return candidate

    for pattern in ("*.inpcrd", "*.rst7", "*.pdb", "*.gro"):
        for candidate in sorted(directory.glob(pattern)):
            if candidate.resolve() == topology.resolve():
                continue
            if _is_topology_only_file(candidate):
                continue
            if candidate.stem.lower() == stem:
                return candidate
    return None


def _load_structure_for_headgroup_detection(
    topology: Path, trajectories: list[Path] | None = None
) -> mda.Universe:
    """Load a universe suitable for inspecting lipid atom names."""
    if trajectories:
        coord_trajs = _filter_coordinate_trajectories(topology, trajectories)
        if coord_trajs:
            return _load_analysis_universe(topology, trajectories)

    if _is_topology_only_file(topology):
        companion = _companion_coordinate_file(topology)
        if companion is not None:
            return mda.Universe(str(topology.resolve()), str(companion.resolve()))

    return load_structure(str(topology))
def load_structure(
    path: Path | str, topology: str | None = None, needs_bonds: bool = False
) -> mda.Universe:
    """Return an MDAnalysis Universe for path, reusing a cache while mtime/size match."""
    path = Path(path).resolve()
    stat = path.stat()
    mtime = stat.st_mtime
    file_size = stat.st_size
    with FILE_CACHE_LOCK:
        key = str(path)
        entry = FILE_CACHE.get(key)
        if entry is None or entry.mtime != mtime or entry.size != file_size:
            top_path = Path(topology).resolve() if topology else None
            if top_path and top_path != path:
                u = mda.Universe(str(top_path), str(path))
            else:
                u = mda.Universe(str(path))
            FILE_CACHE[key] = FileCacheEntry(mtime, file_size, u)
        else:
            u = entry.universe
        if needs_bonds and not entry.bond_guessed:
            print(f"INFO:     /get-structure guessing bonds for {path}")
            u.atoms.guess_bonds()  # TODO: improve performance
            entry.bond_guessed = True
        return u


app = FastAPI(title="GateWizard Backend")


def sanitize_value(obj):
    """Recursively convert numpy scalars/arrays to Python builtins."""
    if isinstance(obj, dict):
        return {sanitize_value(k): sanitize_value(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return type(obj)(sanitize_value(v) for v in obj)
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    return obj


# Renderer may load from Vite (e.g. http://localhost:5173) while the API is on
# 127.0.0.1:8765 — browsers require CORS for that cross-origin fetch.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class RunPropKaRequest(BaseModel):
    path: str = Field(..., description="Absolute path to a PDB/mmCIF file")
    target_ph: float = Field(..., description="Target pH")
    cap_protein: bool = Field(False, description="Cap the protein")
    working_dir: str | None = Field(
        None, description="Project working directory from the GUI top bar"
    )
    output_folder_name: str | None = Field(
        None, description="Output folder name under working_dir"
    )


class DetectLigandsRequest(BaseModel):
    path: str = Field(..., description="Absolute path to a PDB/mmCIF file")


class ParametrizeLigandRequest(BaseModel):
    path: str = Field(..., description="Absolute path to a PDB/mmCIF file")
    ligand_name: str = Field(..., description="3-letter residue name of the ligand")
    charge: int = Field(0, description="Net charge of the ligand")
    multiplicity: int = Field(1, description="Spin multiplicity")
    output_dir: str | None = Field(
        None,
        description=(
            "Base directory for ligand_params/ (Builder output folder). "
            "Defaults to the PDB parent directory if omitted."
        ),
    )


class ValidateBuilderRequest(BaseModel):
    path: str = Field(..., description="Absolute path to a PDB/mmCIF file")
    upper_lipids: List[str] = Field(..., description="Upper leaflet lipid names")
    lower_lipids: List[str] = Field(..., description="Lower leaflet lipid names")
    lipid_ratios: str = Field(
        ..., description="Lipid ratios as upper_ratios//lower_ratios"
    )
    water_model: str = "opc"
    protein_ff: str = "ff19SB"
    lipid_ff: str = "lipid21"
    md_engine: str | None = Field(
        None,
        description="Target MD engine (namd, gromacs, openmm). Enables NAMD-specific OPC tleap when namd+opc.",
    )
    salt_concentration: float = 0.15
    cation: str = "K+"
    anion: str = "Cl-"
    add_salt: bool = True
    dist: float = Field(
        12,
        description="Minimum solute-to-box-boundary distance in Angstroms (--dist)",
    )
    dist_wat: float = Field(26, description="Water layer thickness in Angstroms")
    remove_protein_h: bool = Field(
        False,
        description="When True, skip the protein-hydrogen warning (user will strip H).",
    )


class StartPreparationRequest(BaseModel):
    path: str = Field(..., description="Absolute path to a PDB/mmCIF file")
    upper_lipids: List[str] = Field(..., description="Upper leaflet lipid names")
    lower_lipids: List[str] = Field(..., description="Lower leaflet lipid names")
    lipid_ratios: str = Field(..., description="Lipid ratios")
    water_model: str = "opc"
    protein_ff: str = "ff19SB"
    lipid_ff: str = "lipid21"
    md_engine: str | None = Field(
        None,
        description="Target MD engine (namd, gromacs, openmm). Enables NAMD-specific OPC tleap when namd+opc.",
    )
    preoriented: bool = True
    parametrize: bool = True
    not_protonate: bool = Field(
        True,
        description=(
            "Pass --notprotonate to packmol-memgen. Recommended when the PDB was "
            "prepared with PropKa (GLH/ASH/…); avoids reduce re-protonation that "
            "can break tleap (e.g. HCA atom names)."
        ),
    )
    remove_protein_h: bool = Field(
        False,
        description=(
            "Strip protein hydrogens before packmol-memgen. Keeps ligand / hetero "
            "hydrogens. Recommended when the PDB has non-Amber H (e.g. Schrödinger output)."
        ),
    )
    salt_concentration: float = 0.15
    cation: str = "K+"
    anion: str = "Cl-"
    dist: float = Field(
        12,
        description="Minimum solute-to-box-boundary distance in Angstroms (--dist)",
    )
    dist_wat: float = Field(26, description="Water layer thickness in Angstroms")
    dims: List[float] | None = None
    output_folder_name: str | None = None
    working_dir: str | None = Field(
        None, description="Project working directory from the GUI top bar"
    )
    ligand_params: list | None = None
    nloop: int = Field(20, description="GENCAN loops for PACKMOL (--nloop)")
    nloop_all: int = Field(
        100, description="GENCAN loops for all-together packing (--nloop_all)"
    )
    tolerance: float = Field(
        2.0, description="PACKMOL clash tolerance, radius1+radius2 (--tolerance)"
    )


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/available-lipids")
def available_lipids() -> dict:
    manager = ForceFieldManager()
    return {"lipids": manager.get_available_lipids()}


@app.get("/available-forcefields")
def available_forcefields() -> dict:
    manager = ForceFieldManager()
    return {
        "water_models": manager.get_water_models(),
        "protein_ffs": manager.get_protein_force_fields(),
        "lipid_ffs": manager.get_lipid_force_fields(),
    }


@app.get("/ping")
def ping() -> dict:
    try:
        gw_version = metadata.version("gatewizard")
    except metadata.PackageNotFoundError:
        gw_version = None
    return {"message": "pong", "gatewizard_version": gw_version}


@app.get("/dependency-versions")
def dependency_versions() -> dict:
    """Return installed dependency versions for reproducibility and citation."""
    report = get_dependency_versions(
        include_optional=True,
        include_platform=True,
        include_external_tools=True,
    )

    backend_packages = {
        "fastapi": "GateWizard GUI HTTP API",
        "uvicorn": "GateWizard GUI backend server",
    }
    for name, description in backend_packages.items():
        try:
            version = metadata.version(name)
            available = True
        except metadata.PackageNotFoundError:
            version = None
            available = False
        report["dependencies"][name] = {
            "available": available,
            "required": True,
            "install_group": "gui",
            "description": description,
            "version": version,
        }

    return report


@app.post("/run-propka")
def run_propka(payload: RunPropKaRequest) -> dict:
    path = os.path.abspath(os.path.expanduser(payload.path))
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    try:
        job_dir, path_obj = _resolve_preparation_workspace(
            payload.working_dir,
            payload.output_folder_name,
            path,
        )
        path = str(path_obj)
        residue_renumbering_table = {}
        capping_warning = None
        if payload.cap_protein:
            caps_found = detect_terminal_caps(path_obj)
            looks_capped = bool(caps_found) or path_obj.stem.endswith("_capped")
            if looks_capped:
                # Skip re-capping — ACE/NME already present (or filename marks it).
                detail = (
                    ", ".join(caps_found)
                    if caps_found
                    else "filename ends with _capped"
                )
                capping_warning = (
                    "Structure already appears capped "
                    f"({detail}). Skipping ACE/NME capping. "
                    "Uncheck “Cap protein termini” if this was intentional."
                )
                path = str(path_obj)
            else:
                capped_path = path_obj.parent / f"{path_obj.stem}_capped.pdb"
                path, residue_renumbering_table = cap_protein(path, str(capped_path))
                path_obj = Path(path)
                residue_renumbering_table = {
                    "_".join(map(str, old)): new[2]  # (name, chain, id) -> new_id
                    for old, new in residue_renumbering_table.items()
                    if old != new
                }
        manager = PreparationManager(propka_version="3")
        manager.run_analysis(path, output_dir=str(job_dir))
        summary_file = manager.extract_summary(manager.last_analysis_file)
        residues = manager.parse_summary(summary_file)
        for data in residues:
            state = manager.get_default_protonation_state(data, payload.target_ph)
            data["current_state"] = data["initial_state"] = state
            data["all_states"] = list(
                manager.get_available_states(data["residue"]).values()
            )
        residues = [it for it in residues if len(it["all_states"]) > 1]
        return dict(
            residues=residues,
            residue_renumbering_table=residue_renumbering_table,
            job_dir=str(job_dir),
            working_path=path,
            capping_warning=capping_warning,
        )

    except Exception as ex:
        import traceback

        tb_str = "".join(traceback.format_exception(type(ex), ex, ex.__traceback__))
        raise HTTPException(status_code=400, detail=str(ex) + "\n" + tb_str) from ex


@app.post("/detect-ligands")
def detect_ligands_endpoint(payload: DetectLigandsRequest) -> dict:
    path = os.path.abspath(os.path.expanduser(payload.path))
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    try:
        ligands = detect_ligands(path)
        return {
            "ligands": [
                {
                    "name": lig.name,
                    "chain": lig.chain,
                    "res_id": lig.res_id,
                    "num_atoms": lig.num_atoms,
                    "pdb_lines": lig.pdb_lines,
                }
                for lig in ligands
            ]
        }
    except Exception as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex


@app.post("/detect-terminal-caps")
def detect_terminal_caps_endpoint(payload: DetectLigandsRequest) -> dict:
    """Report ACE/NME/NMA caps already present in a PDB (skip re-capping)."""
    path = os.path.abspath(os.path.expanduser(payload.path))
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    try:
        caps = detect_terminal_caps(path)
        stem_capped = Path(path).stem.endswith("_capped")
        return {
            "caps": caps,
            "already_capped": bool(caps) or stem_capped,
            "stem_ends_with_capped": stem_capped,
        }
    except Exception as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex


@app.post("/protein-hydrogen-status")
def protein_hydrogen_status(payload: DetectLigandsRequest) -> dict:
    """Count protein-only hydrogens (ligands / hetero H are ignored)."""
    path = os.path.abspath(os.path.expanduser(payload.path))
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    try:
        count = count_protein_hydrogens(path)
        return {"count": count, "has_protein_hydrogens": count > 0}
    except Exception as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex


@app.post("/parametrize-ligand")
def parametrize_ligand_endpoint(payload: ParametrizeLigandRequest) -> dict:
    path = os.path.abspath(os.path.expanduser(payload.path))
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    if payload.output_dir:
        working_dir = os.path.abspath(os.path.expanduser(payload.output_dir))
    else:
        working_dir = os.path.dirname(path)
    try:
        result = parametrize_ligand_from_system_pdb(
            pdb_file=path,
            ligand_name=payload.ligand_name,
            output_dir=working_dir,
            charge=payload.charge,
            multiplicity=payload.multiplicity,
        )
        return result
    except Exception as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex


class LigandImageRequest(BaseModel):
    pdb_lines: list[str] | None = None
    mol2_path: str | None = None
    width: int = 400
    height: int = 300


@app.post("/ligand-image")
def ligand_image_endpoint(payload: LigandImageRequest) -> dict:
    """Generate a 2D depiction of a ligand. Returns base64 PNG."""
    with tempfile.TemporaryDirectory() as tmpdir:
        out_path = os.path.join(tmpdir, "ligand.png")
        try:
            if payload.mol2_path and os.path.isfile(payload.mol2_path):
                get_ligand_2d_image(
                    payload.mol2_path,
                    out_path,
                    width=payload.width,
                    height=payload.height,
                )
            elif payload.pdb_lines:
                get_ligand_2d_image_from_pdb_lines(
                    payload.pdb_lines,
                    out_path,
                    width=payload.width,
                    height=payload.height,
                )
            else:
                raise HTTPException(
                    status_code=400, detail="Provide pdb_lines or mol2_path"
                )

            if not os.path.isfile(out_path):
                raise HTTPException(status_code=500, detail="Image generation failed")

            with open(out_path, "rb") as f:
                b64 = base64.b64encode(f.read()).decode("ascii")
            return {"image": b64}
        except HTTPException:
            raise
        except Exception as ex:
            raise HTTPException(status_code=400, detail=str(ex)) from ex


class CheckParamRequest(BaseModel):
    pdb_path: str
    ligand_names: list[str]
    output_dir: str | None = Field(
        None,
        description=(
            "Preferred base directory for ligand_params/ (Builder output folder). "
            "Falls back to the PDB parent if not provided or nothing is found there."
        ),
    )


def _tleap_log_ok(log_path: Path) -> bool:
    """Return True if tleap finished with zero errors."""
    try:
        text = log_path.read_text()
        m = re.search(r"Exiting LEaP:\s*Errors\s*=\s*(\d+)", text)
        return m is not None and int(m.group(1)) == 0
    except OSError:
        return False


def _find_ligand_param_cache(
    base_dirs: list[Path], ligand_names: list[str]
) -> dict[str, dict[str, str | None]]:
    """Return cached frcmod/lib/mol2 for ligands under the first matching base dir."""
    found: dict[str, dict[str, str | None]] = {}
    for base in base_dirs:
        for name in ligand_names:
            if name in found:
                continue
            lig_dir = base / "ligand_params" / name
            frcmod = lig_dir / f"{name}.frcmod"
            lib = lig_dir / f"{name}.lib"
            mol2 = lig_dir / f"{name}.mol2"
            tleap_log = lig_dir / "logs" / "tleap.log"
            if frcmod.is_file() and lib.is_file() and tleap_log.is_file():
                if _tleap_log_ok(tleap_log):
                    found[name] = {
                        "frcmod": str(frcmod),
                        "lib": str(lib),
                        "mol2": str(mol2) if mol2.is_file() else None,
                    }
        if len(found) == len(ligand_names):
            break
    return found


@app.post("/check-ligand-parametrization")
def check_ligand_param(payload: CheckParamRequest) -> dict:
    """Check which ligands already have frcmod/lib from a previous run."""
    pdb_dir = Path(os.path.abspath(os.path.expanduser(payload.pdb_path))).parent
    bases: list[Path] = []
    if payload.output_dir:
        bases.append(Path(os.path.abspath(os.path.expanduser(payload.output_dir))))
    if pdb_dir not in bases:
        bases.append(pdb_dir)
    return {"parametrized": _find_ligand_param_cache(bases, payload.ligand_names)}


class JobStatusRequest(BaseModel):
    job_dir: str = Field(..., description="Absolute path to the job directory")


@app.post("/job-status")
def job_status(payload: JobStatusRequest) -> dict:
    """Read the current status.json for a running/completed job."""
    import json

    job_dir = Path(os.path.abspath(os.path.expanduser(payload.job_dir)))
    status_file = job_dir / "status.json"
    if not status_file.is_file():
        raise HTTPException(status_code=404, detail="status.json not found")
    try:
        with open(status_file, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as ex:
        raise HTTPException(status_code=500, detail=str(ex)) from ex


class JobLogRequest(BaseModel):
    job_dir: str = Field(..., description="Absolute path to the job directory")
    log_name: str = Field("preparation.log", description="Log filename in logs/")
    tail: int = Field(200, description="Number of lines from the end to return")


@app.post("/job-log")
def job_log(payload: JobLogRequest) -> dict:
    """Read the tail of a log file for a running/completed job."""
    job_dir = Path(os.path.abspath(os.path.expanduser(payload.job_dir)))
    log_file = job_dir / "logs" / payload.log_name
    if not log_file.is_file():
        return {"lines": [], "exists": False}
    try:
        all_lines = log_file.read_text(encoding="utf-8", errors="replace").splitlines()
        return {"lines": all_lines[-payload.tail :], "exists": True}
    except Exception as ex:
        raise HTTPException(status_code=500, detail=str(ex)) from ex


class ScanJobsRequest(BaseModel):
    directory: str = Field(..., description="Absolute path to the working directory")


@app.post("/scan-jobs")
def scan_jobs(payload: ScanJobsRequest) -> dict:
    """Scan a directory for preparation job sub-directories (those containing status.json)."""
    import json as _json

    base = Path(os.path.abspath(os.path.expanduser(payload.directory)))
    if not base.is_dir():
        raise HTTPException(status_code=404, detail=f"Not a directory: {base}")
    found = []
    for status_file in base.glob("*/status.json"):
        job_dir = status_file.parent
        try:
            data = _json.loads(status_file.read_text(encoding="utf-8"))
        except Exception:
            continue
        found.append(
            {
                "job_dir": str(job_dir),
                "name": job_dir.name,
                "status": data.get("status", "unknown"),
                "current_step": data.get("current_step", 0),
                "steps": data.get("steps", []),
                "steps_completed": data.get("steps_completed", []),
                "error": data.get("error"),
                "start_time": data.get("start_time"),
                "end_time": data.get("end_time"),
            }
        )
    # Most recent jobs first
    found.sort(key=lambda j: j.get("start_time") or "", reverse=True)
    return {"jobs": found}


@app.get("/project-status")
def project_status(directory: str) -> dict:
    """Return a compact project-wide status summary for the status bar.

    Scans the working directory for:
    - Preparation jobs (sub-dirs with status.json)
    - Equilibration runs (sub-dirs with run_equilibration.sh + a log/pid file)

    Returns a single dict the status bar can display directly.
    """
    import json as _json

    base = Path(os.path.abspath(os.path.expanduser(directory)))
    if not base.is_dir():
        return {"tasks": [], "active": False}

    tasks = []

    # ── Preparation jobs ──
    for status_file in sorted(base.glob("*/status.json")):
        job_dir = status_file.parent
        # Skip ligand param sub-dirs (they have ligand_name key, not steps)
        try:
            data = _json.loads(status_file.read_text(encoding="utf-8"))
        except Exception:
            continue
        if "ligand_name" in data:
            continue

        status = data.get("status", "unknown")
        steps = data.get("steps", [])
        steps_completed = data.get("steps_completed", [])
        current_step = data.get("current_step", 0)
        total_steps = len(steps) if steps else 1
        # Normalise progress: steps_completed may just be ["Completed"]
        if status == "completed":
            progress = 1.0
        elif total_steps > 0 and isinstance(current_step, int):
            progress = min(current_step / total_steps, 0.99)
        else:
            progress = 0.0

        tasks.append(
            {
                "id": str(job_dir),
                "name": job_dir.name,
                "type": "preparation",
                "status": status,
                "progress": progress,
                "current_step": current_step,
                "total_steps": total_steps,
                "steps": steps,
                "steps_completed": steps_completed,
                "start_time": data.get("start_time"),
                "end_time": data.get("end_time"),
                "error": data.get("error"),
            }
        )

    # ── Equilibration runs ──
    for eq_dir in sorted(base.glob("*/run_equilibration.sh")):
        eq_dir = eq_dir.parent
        # Detect engine from directory name or files present
        if list(eq_dir.glob("*.mdp")):
            engine = "gromacs"
        elif list(eq_dir.glob("*.inp")):
            engine = "openmm"
        else:
            engine = "namd"

        pid_file = eq_dir / "equilibration.pid"
        if not pid_file.exists() and not list(eq_dir.glob("*.log")):
            continue  # never started

        # Collect stage logs to compute progress
        log_files = sorted(eq_dir.glob("step*.log"))
        total = len(log_files)
        if total == 0:
            # Fall back to counting expected steps from run script
            run_script = eq_dir / "run_equilibration.sh"
            try:
                script = run_script.read_text(encoding="utf-8")
                total = script.count("Stage ")
            except Exception:
                total = 7  # default protocol length

        completed_logs = [f for f in log_files if f.stat().st_size > 0]
        n_done = len(completed_logs)

        # Determine overall status — prefer live process over log heuristics
        bg_log = eq_dir / "equilibration_background.log"
        error_msg = None
        if bg_log.exists():
            try:
                # Check a short tail for run-script failure echoes; avoid
                # substring "error" (GROMACS warns about "spelling error").
                tail = "\n".join(
                    bg_log.read_text(
                        encoding="utf-8", errors="replace"
                    ).splitlines()[-40:]
                )
                error_msg = _equilibration_log_failure_line(tail)
            except Exception:
                pass

        pid_alive = False
        if pid_file.exists():
            try:
                pid = int(pid_file.read_text().strip())
                os.kill(pid, 0)
                pid_alive = True
            except (ValueError, ProcessLookupError, PermissionError, OSError):
                pid_alive = False

        if pid_alive:
            eq_status = "running"
        elif error_msg:
            eq_status = "error"
        elif n_done >= total > 0:
            eq_status = "completed"
        elif pid_file.exists() and n_done < total:
            # Stale pid, incomplete stages, no clear failure marker
            eq_status = "error"
        else:
            eq_status = "not_started"

        tasks.append(
            {
                "id": str(eq_dir),
                "name": eq_dir.name,
                "type": "equilibration",
                "engine": engine,
                "status": eq_status,
                "progress": (n_done / total) if total > 0 else 0.0,
                "current_step": n_done,
                "total_steps": total,
                "error": error_msg,
                "start_time": None,
                "end_time": None,
            }
        )

    active = any(t["status"] == "running" for t in tasks)
    return {"tasks": tasks, "active": active}


@app.post("/validate-builder")
def validate_builder(payload: ValidateBuilderRequest) -> dict:
    path = os.path.abspath(os.path.expanduser(payload.path))
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    try:
        builder = Builder()
        is_valid, error_msg = builder.validate_system_inputs(
            pdb_file=path,
            upper_lipids=payload.upper_lipids,
            lower_lipids=payload.lower_lipids,
            lipid_ratios=payload.lipid_ratios,
            water_model=payload.water_model,
            protein_ff=payload.protein_ff,
            lipid_ff=payload.lipid_ff,
            add_salt=payload.add_salt,
            salt_concentration=payload.salt_concentration,
            cation=payload.cation,
            anion=payload.anion,
            dist=payload.dist,
            dist_wat=payload.dist_wat,
            remove_protein_h=payload.remove_protein_h,
        )
        # Distinguish warning (valid but message present) from clean success
        is_warning = is_valid and bool(error_msg)
        protein_h_count = 0
        try:
            protein_h_count = count_protein_hydrogens(path)
        except OSError:
            protein_h_count = 0
        return {
            "valid": is_valid,
            "warning": is_warning,
            "message": error_msg or "",
            "protein_hydrogen_count": protein_h_count,
            "protein_hydrogen_warning": is_warning
            and "Remove protein hydrogens" in (error_msg or ""),
        }
    except Exception as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex


def _configure_builder(payload: StartPreparationRequest) -> Builder:
    builder = Builder()
    builder.set_configuration(
        water_model=payload.water_model,
        protein_ff=payload.protein_ff,
        lipid_ff=payload.lipid_ff,
        md_engine=payload.md_engine,
        preoriented=payload.preoriented,
        parametrize=payload.parametrize,
        notprotonate=payload.not_protonate,
        remove_protein_h=payload.remove_protein_h,
        salt_concentration=payload.salt_concentration,
        cation=payload.cation,
        anion=payload.anion,
        dist=payload.dist,
        dist_wat=payload.dist_wat,
        dims=payload.dims,
        output_folder_name=payload.output_folder_name or None,
        ligand_params={
            lp["name"]: {"frcmod": lp["frcmod"], "lib": lp["lib"]}
            for lp in (payload.ligand_params or [])
        },
        nloop=payload.nloop,
        nloop_all=payload.nloop_all,
        tolerance=payload.tolerance,
    )
    return builder


@app.post("/generate-preparation")
def generate_preparation(payload: StartPreparationRequest) -> dict:
    path = os.path.abspath(os.path.expanduser(payload.path))
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    working_dir = payload.working_dir or os.path.dirname(path)
    working_dir = os.path.abspath(os.path.expanduser(working_dir))
    try:
        builder = _configure_builder(payload)
        success, message, job_dir = builder.generate_preparation_inputs(
            pdb_file=path,
            working_dir=working_dir,
            upper_lipids=payload.upper_lipids,
            lower_lipids=payload.lower_lipids,
            lipid_ratios=payload.lipid_ratios,
        )
        return {"success": success, "message": message, "job_dir": str(job_dir)}
    except Exception as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex


class RunPreparationRequest(BaseModel):
    job_dir: str = Field(..., description="Absolute path to the preparation job directory")


@app.post("/run-preparation")
def run_preparation(payload: RunPreparationRequest) -> dict:
    job_dir = Path(os.path.abspath(os.path.expanduser(payload.job_dir)))
    if not job_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Directory not found: {job_dir}")
    try:
        builder = Builder()
        success, message = builder.run_preparation(job_dir)
        return {"success": success, "message": message, "job_dir": str(job_dir)}
    except Exception as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex


@app.post("/start-preparation")
def start_preparation(payload: StartPreparationRequest) -> dict:
    path = os.path.abspath(os.path.expanduser(payload.path))
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    working_dir = payload.working_dir or os.path.dirname(path)
    working_dir = os.path.abspath(os.path.expanduser(working_dir))
    try:
        builder = _configure_builder(payload)
        success, message, job_dir = builder.prepare_system(
            pdb_file=path,
            working_dir=working_dir,
            upper_lipids=payload.upper_lipids,
            lower_lipids=payload.lower_lipids,
            lipid_ratios=payload.lipid_ratios,
        )
        return {"success": success, "message": message, "job_dir": str(job_dir)}
    except Exception as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex


class DetectDisulfideBondsRequest(BaseModel):
    path: str = Field(..., description="Absolute path to a PDB/mmCIF file")
    max_disulfide_distance: float = Field(
        2.5, description="Maximum distance between disulfide bonds"
    )
    working_dir: str | None = Field(
        None, description="Project working directory from the GUI top bar"
    )
    output_folder_name: str | None = Field(
        None, description="Output folder name under working_dir"
    )


@app.post("/detect-disulfide-bonds")
def detect_disulfide_bonds(payload: DetectDisulfideBondsRequest) -> dict:
    path = os.path.abspath(os.path.expanduser(payload.path))
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    _, path_obj = _resolve_preparation_workspace(
        payload.working_dir,
        payload.output_folder_name,
        path,
    )
    manager = PreparationManager()
    disulfide_bonds = manager.detect_disulfide_bonds(
        str(path_obj), payload.max_disulfide_distance
    )
    return {
        "disulfide_bonds": disulfide_bonds,
        "job_dir": str(path_obj.parent),
        "working_path": str(path_obj),
    }


class PreparePDBRequest(BaseModel):
    path: str = Field(description="Absolute path to a PDB/mmCIF file")
    output_path: str = Field(description="Absolute path to the output PDB/mmCIF file")
    protonation_states: list[dict] = Field(description="Protonation states")
    target_ph: float = Field(description="Target pH")
    disulfide_bonds: list[tuple[tuple[str, int], tuple[str, int]]] = Field(
        description="Disulfide bonds"
    )
    remove_protein_hydrogens: bool = Field(
        True,
        description=(
            "Strip protein hydrogens before pdb4amber. Ligands and other hetero "
            "atoms keep their hydrogens. Recommended to avoid non-Amber H "
            "(e.g. Schrödinger) breaking later tleap parametrization."
        ),
    )
    working_dir: str | None = Field(
        None, description="Project working directory from the GUI top bar"
    )
    output_folder_name: str | None = Field(
        None, description="Output folder name under working_dir"
    )


class EnsureOutputFolderRequest(BaseModel):
    working_dir: str = Field(description="Project working directory from the GUI top bar")
    output_folder_name: str = Field(description="Output folder name to create under working_dir")


def _ensure_conda_tools_on_path() -> None:
    """Prepend CONDA_PREFIX/bin to PATH so AmberTools subprocesses resolve on macOS."""
    prefix = os.environ.get("CONDA_PREFIX", "")
    if not prefix:
        return
    bin_dir = os.path.join(prefix, "bin")
    path = os.environ.get("PATH", "")
    parts = [p for p in path.split(os.pathsep) if p] if path else []
    if bin_dir not in parts:
        os.environ["PATH"] = bin_dir + (os.pathsep + path if path else "")


@app.post("/ensure-output-folder")
def ensure_output_folder(payload: EnsureOutputFolderRequest) -> dict:
    out = _ensure_output_folder(payload.working_dir, payload.output_folder_name)
    return {"output_dir": str(out)}


@app.post("/prepare-pdb")
def prepare_pdb(payload: PreparePDBRequest) -> dict:
    _ensure_conda_tools_on_path()
    path = os.path.abspath(os.path.expanduser(payload.path))
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    job_dir, path_obj = _resolve_preparation_workspace(
        payload.working_dir,
        payload.output_folder_name,
        path,
    )
    path = str(path_obj)
    if payload.working_dir:
        output_path = _protonated_output_path(job_dir, path_obj)
    else:
        output_path = _ensure_writable_output_file(payload.output_path)

    def get_residue_id(info: dict) -> str:
        resid = info["residue"] + str(info["res_id"])
        if info["chain"]:
            resid += "_" + info["chain"]
        return resid

    manager = PreparationManager()
    fd, tmp_path = tempfile.mkstemp(suffix=".pdb")
    os.close(fd)

    try:
        custom_states = {
            get_residue_id(info): info["current_state"]
            for info in payload.protonation_states
            if info["current_state"] != info["initial_state"]
        }
        manager.apply_protonation_states(
            path,
            tmp_path,
            payload.target_ph,
            custom_states,
            payload.protonation_states,
        )

        manager.apply_disulfide_bonds(tmp_path, tmp_path, payload.disulfide_bonds)

        removed_h = 0
        if payload.remove_protein_hydrogens:
            strip_result = strip_protein_hydrogens(tmp_path, tmp_path)
            removed_h = int(strip_result.get("removed", 0))

        result = manager.run_pdb4amber_with_cap_fix(
            input_pdb=tmp_path,
            output_pdb=str(output_path),
            fix_caps="capped" in path,
        )
        note = ""
        if payload.remove_protein_hydrogens:
            note = f"\nRemoved {removed_h} protein hydrogen atom(s) before pdb4amber."
        return dict(
            output=result["stdout"] + "\n" + result["stderr"] + note,
            output_path=str(output_path),
            job_dir=str(job_dir),
            working_path=path,
            protein_hydrogens_removed=removed_h,
        )
    except (PreparationError, FileNotFoundError, OSError, ValueError) as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex
    except Exception as ex:
        import traceback

        tb_str = "".join(traceback.format_exception(type(ex), ex, ex.__traceback__))
        raise HTTPException(status_code=400, detail=str(ex) + "\n" + tb_str) from ex
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


class ProgramConfig(BaseModel):
    engine: str = Field(description="Engine name: namd, gromacs, or openmm")
    executable: str = Field(description="Executable path or command name")
    gmxrc: str | None = Field(
        None,
        description="Optional GROMACS GMXRC path to source in run scripts",
    )


class Constraint(BaseModel):
    name: str = Field(description="Constraint name")
    force_constant: float = Field(
        description="Constraint force constant (kcal/mol/A^2)"
    )
    selection: str = Field(description="MDAnalysis selection string")


class Stage(BaseModel):
    constraints: list[Constraint] = Field(description="List of constraints")
    cpu_cores: int = Field(description="Number of CPU cores")
    dcd_freq: int = Field(description="Frame output frequency")
    description: str = Field(description="Stage description")
    ensemble: str | None = Field(description="NVT, NPT, etc.")
    gpu_id: int | None = Field(description="GPU ID to use")
    margin: float | None = Field(description="Nonbonded margin parameter", default=5)
    minimize_steps: int | None = Field(
        description="Energy minimization steps", default=None
    )
    name: str = Field(description="Stage name")
    num_gpus: int | None = Field(description="Number of GPUs to use")
    pressure: float | None = Field(description="Pressure in bar")
    steps: int = Field(description="Number of MD steps")
    surface_tension: float | None = Field(
        description="Surface tension in dyne/cm", default=None
    )
    temperature: float = Field(description="Temperature in Kelvin")
    time_ns: float = Field(description="Stage time in nanoseconds")
    timestep: float = Field(description="Integration timestep (fs)")
    use_gpu: bool = Field(description="Whether to use GPU")


class Protocol(BaseModel):
    name: str = Field(description="Protocol name")
    stages: list[Stage] = Field(description="Protocol stages")
    description: str = Field(description="Overall protocol description")


class GenerateEquilibrationRequest(BaseModel):
    input_dir: str = Field(description="Absolute path to the input directory")
    output_dir: str = Field(description="Name of the output directory")
    ensemble: str = Field(description="Simulation ensemble (NVT, NPT, etc.)")
    program_config: ProgramConfig = Field(description="Program configuration")
    protocol: Protocol = Field(description="Simulation protocol")
    add_com_restraint: bool = Field(False, description="Generate COM restraint")
    com_selection: str = Field(
        "name CA",
        description="MDAnalysis selection used to define COM/rotation reference atoms",
    )
    com_restraint_k: float = Field(
        10.0, description="COM translation force constant in kcal/mol/A^2"
    )
    add_rotation_restraint: bool = Field(
        False, description="Also generate rotation restraint"
    )
    rotation_restraint_k: float = Field(
        2000.0, description="Rotation force constant in kcal/mol/A^2"
    )
    water_model: str | None = Field(
        None,
        description="Water model override (opc, tip3p, …). Auto-read from builder status.json if omitted.",
    )
    openmm_platform: str | None = Field(
        None,
        description="OpenMM platform override: CUDA, OpenCL, CPU, or null for auto",
    )


class ExecutableCheckRequest(BaseModel):
    engine: str = Field(description="Engine name: namd, gromacs, or openmm")
    executable: str = Field(description="Executable path or command name")


class GenerateComRestraintRequest(BaseModel):
    input_dir: str = Field(description="Absolute path to the input directory")
    output_dir: str = Field(description="Absolute path to the output directory")
    program_config: ProgramConfig = Field(description="Program configuration")
    com_selection: str = Field(
        "name CA",
        description="MDAnalysis selection used to define COM/rotation reference atoms",
    )
    com_restraint_k: float = Field(
        10.0, description="COM translation force constant in kcal/mol/A^2"
    )
    add_rotation_restraint: bool = Field(
        False, description="Also generate rotation restraint"
    )
    rotation_restraint_k: float = Field(
        2000.0, description="Rotation force constant in kcal/mol/A^2"
    )


def _resolve_executable(executable: str) -> str | None:
    executable = executable.strip()
    if not executable:
        return None
    if os.path.isabs(executable) or os.path.sep in executable:
        return executable if os.path.isfile(executable) else None
    return shutil.which(executable)


def _executable_for_equilibration_setup(
    engine: str, executable: str, *, require_on_path: bool
) -> str:
    """Resolve an MD engine executable for input-file generation.

    NAMD/OpenMM only embed the executable in run scripts during setup; GROMACS
    may invoke ``gmx`` (e.g. ``make_ndx``) while generating files.
    """
    executable = executable.strip()
    if not executable:
        raise HTTPException(status_code=400, detail="Executable cannot be empty")
    resolved = _resolve_executable(executable)
    if require_on_path and not resolved:
        raise HTTPException(
            status_code=400,
            detail=f"Executable not found: {executable}",
        )
    return resolved or executable


def _run_version_probe(executable: str, engine: str) -> str | None:
    probe_args = {
        "namd": ["-version"],
        "gromacs": ["--version"],
        "openmm": ["--version"],
    }
    try:
        cmd = [executable] + probe_args.get(engine, ["--version"])
        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=4,
            check=False,
        )
        text = (proc.stdout or "").strip()
        if text:
            return text.splitlines()[0][:200]
    except Exception:
        return None
    return None


def _find_preferred_system_pdb(input_dir: Path) -> Path | None:
    pdb_files = list(input_dir.glob("*.pdb"))
    if not pdb_files:
        return None
    return next((f for f in pdb_files if f.name.lower() == "system.pdb"), pdb_files[0])


def _normalize_constraint_key(name: str) -> str:
    """Normalize a constraint display name to an API key.

    Maps e.g. "Protein backbone" -> "protein_backbone" so that GUI display
    names are understood by the equilibration API, which expects lowercase
    underscore-separated keys such as ``protein_backbone``, ``lipid_head``.
    """
    return name.strip().lower().replace(" ", "_")


_DEFAULT_CONSTRAINT_SELECTIONS = {
    **getattr(NAMDEquilibrationManager, "DEFAULT_SELECTIONS", {}),
    "ion": getattr(NAMDEquilibrationManager, "DEFAULT_SELECTIONS", {}).get(
        "ions", ION_SELECTION
    ),
}


def _resolve_constraint_selection(selection: str) -> str:
    """Resolve known selection aliases to MDAnalysis selection strings.

    The GUI may contain shorthand aliases (e.g. ``protein_backbone``, ``ions``)
    in protocol constraints. Convert those aliases to concrete MDAnalysis
    expressions before passing them to equilibration managers.
    """
    sel = selection.strip()
    if not sel:
        return sel

    # Shorthands used by structure endpoints.
    if sel in NAMED_SELECTIONS:
        return NAMED_SELECTIONS[sel]

    # Protocol aliases used by equilibration constraints.
    key = _normalize_constraint_key(sel)
    if key in _DEFAULT_CONSTRAINT_SELECTIONS:
        return _DEFAULT_CONSTRAINT_SELECTIONS[key]

    return sel


_VALID_ENSEMBLES = frozenset({"NVT", "NPT", "NPAT", "NPgT"})
_ENSEMBLE_ALIASES = {
    "nvt": "NVT",
    "npt": "NPT",
    "npat": "NPAT",
    "npgt": "NPgT",
}


def _normalize_ensemble(value: str) -> str:
    """Map GUI/API ensemble strings to gatewizard scheme_type values."""
    key = value.strip()
    if key in _VALID_ENSEMBLES:
        return key
    mapped = _ENSEMBLE_ALIASES.get(key.lower())
    if mapped:
        return mapped
    raise HTTPException(
        status_code=422,
        detail=(
            f"Invalid ensemble '{value}'. Must be one of {sorted(_VALID_ENSEMBLES)}"
        ),
    )


def _build_stage_params(stages: list[Stage]) -> list[dict[str, Any]]:
    params = []
    for stage in stages:
        stage_dump = stage.model_dump()
        if stage_dump.get("ensemble"):
            stage_dump["ensemble"] = _normalize_ensemble(stage_dump["ensemble"])
        stage_dump["constraints"] = {
            _normalize_constraint_key(item.name): item.force_constant
            for item in stage.constraints
        }
        params.append(stage_dump)
    return params


def _build_selections(stages: list[Stage]) -> dict[str, str]:
    """Build a {normalized_key: mda_selection_string} dict from stage constraints.

    This is used to pass selection strings for custom constraints (e.g.
    ``ions_sf``) to the equilibration setup functions so that the restraint
    index files can be generated correctly.
    """
    selections: dict[str, str] = {}
    for stage in stages:
        for item in stage.constraints:
            key = _normalize_constraint_key(item.name)
            if item.selection:
                selections[key] = _resolve_constraint_selection(item.selection)
    return selections


_GROMACS_STD_CONSTRAINT_KEYS = frozenset(
    {
        "protein_backbone",
        "protein_sidechain",
        "lipid_head",
        "lipid_tail",
        "water",
        "ions",
        "ion",
        "other",
    }
)


def _validate_constraint_support(
    engine: str,
    stage_params: list[dict[str, Any]],
    selections: dict[str, str],
) -> None:
    """Validate constraint support for the selected equilibration engine."""
    active_keys = {
        key
        for stage in stage_params
        for key, force in stage.get("constraints", {}).items()
        if float(force) > 0
    }

    if engine in ("gromacs", "openmm"):
        std_keys = _GROMACS_STD_CONSTRAINT_KEYS
        missing = sorted(
            k
            for k in active_keys
            if k not in std_keys and k not in selections
        )
        if missing:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{engine.upper()} custom constraints require a valid "
                    "MDAnalysis selection. Missing selection for: "
                    + ", ".join(missing)
                ),
            )
        return


def _collect_system_files(input_dir: Path) -> dict[str, str]:
    files: dict[str, str] = {}

    prmtop_files = list(input_dir.glob("*.prmtop"))
    if prmtop_files:
        files["prmtop"] = str(prmtop_files[0])

    inpcrd_files = list(input_dir.glob("*.inpcrd"))
    if not inpcrd_files:
        inpcrd_files = list(input_dir.glob("*.rst"))
    if inpcrd_files:
        files["inpcrd"] = str(inpcrd_files[0])

    pdb_file = _find_preferred_system_pdb(input_dir)
    if pdb_file:
        files["pdb"] = str(pdb_file)

    bilayer_files = list(input_dir.glob("bilayer*_lipid.pdb"))
    if bilayer_files:
        files["bilayer_pdb"] = str(bilayer_files[0])

    return files


def _write_openmm_com_params(
    pdb_path: Path,
    output_dir: Path,
    com_selection: str = "name CA",
    com_restraint_k: float = 10.0,
    add_rotation_restraint: bool = False,
) -> Path:
    u = mda.Universe(str(pdb_path))
    ag = u.select_atoms(com_selection)
    if len(ag) == 0:
        raise ValueError(
            f"No atoms matched selection '{com_selection}' for OpenMM COM restraint"
        )

    com = ag.center_of_geometry()
    payload = {
        "ca_indices": [int(a.index) for a in ag],
        "centroid_angstrom": [float(com[0]), float(com[1]), float(com[2])],
        "force_constant_kcal_mol_A2": float(com_restraint_k),
        "add_rotation_restraint": bool(add_rotation_restraint),
    }

    out = output_dir / "com_restraint_params.json"
    out.write_text(json.dumps(payload, indent=2))
    return out


@app.post("/check-executable")
def check_executable(payload: ExecutableCheckRequest) -> dict:
    engine = payload.engine.lower().strip()
    resolved = _resolve_executable(payload.executable)
    if not resolved:
        return {
            "engine": engine,
            "executable": payload.executable,
            "exists": False,
            "resolved_path": None,
            "version": None,
        }

    return {
        "engine": engine,
        "executable": payload.executable,
        "exists": True,
        "resolved_path": resolved,
        "version": _run_version_probe(resolved, engine),
    }


class ListEngineExecutablesRequest(BaseModel):
    engine: str = Field(description="Engine name: namd, gromacs, or openmm")


@app.post("/list-engine-executables")
def list_engine_executables(payload: ListEngineExecutablesRequest) -> dict:
    """Discover NAMD / GROMACS / OpenMM installs for the Equilibration picker."""
    engine = payload.engine.lower().strip()
    try:
        candidates = list_md_engine_candidates(engine)
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex
    return {"engine": engine, "candidates": candidates}


@app.get("/get-openmm-platforms")
def get_openmm_platforms() -> dict:
    try:
        import openmm

        platforms = []
        for i in range(openmm.Platform.getNumPlatforms()):
            p = openmm.Platform.getPlatform(i)
            platforms.append({"name": p.getName(), "speed": p.getSpeed()})
        return {"platforms": platforms}
    except Exception as e:
        return {"platforms": [], "error": str(e)}


@app.post("/generate-equilibration")
def generate_equilibration(payload: GenerateEquilibrationRequest) -> None:
    if not os.path.isdir(payload.input_dir):
        raise HTTPException(
            status_code=404, detail=f"Directory not found: {payload.input_dir}"
        )

    input_dir = Path(payload.input_dir)
    output_dir = Path(payload.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    engine = payload.program_config.engine.lower().strip()
    executable = payload.program_config.executable.strip()

    if engine not in {"namd", "gromacs", "openmm"}:
        raise HTTPException(status_code=400, detail=f"Unsupported engine: {engine}")

    resolved_exec = _executable_for_equilibration_setup(
        engine,
        executable,
        require_on_path=(engine == "gromacs"),
    )

    if engine == "gromacs" and GROMACSEquilibrationManager is None:
        raise HTTPException(
            status_code=501,
            detail="GROMACS support is not available in this gatewizard installation",
        )
    if engine == "openmm" and OpenMMEquilibrationManager is None:
        raise HTTPException(
            status_code=501,
            detail="OpenMM support is not available in this gatewizard installation",
        )

    stage_params = _build_stage_params(payload.protocol.stages)
    selections = _build_selections(payload.protocol.stages)
    _validate_constraint_support(engine, stage_params, selections)
    system_files = _collect_system_files(input_dir)

    if engine == "gromacs":
        if "prmtop" not in system_files or "inpcrd" not in system_files:
            raise HTTPException(
                status_code=404,
                detail="GROMACS setup requires AMBER files (.prmtop and .inpcrd/.rst) in input directory",
            )
        manager = GROMACSEquilibrationManager(input_dir)
        manager.setup_gromacs_equilibration(
            system_files=system_files,
            stage_params_list=stage_params,
            selections=selections,
            output_name=str(output_dir),
            scheme_type=_normalize_ensemble(payload.ensemble),
            gmx_executable=resolved_exec,
            gmxrc_path=(payload.program_config.gmxrc or None),
            add_com_restraint=payload.add_com_restraint,
            com_selection=payload.com_selection,
            com_restraint_k=payload.com_restraint_k,
            add_rotation_restraint=payload.add_rotation_restraint,
            rotation_restraint_k=payload.rotation_restraint_k,
        )
        return

    if engine == "openmm":
        if "prmtop" not in system_files or "inpcrd" not in system_files:
            raise HTTPException(
                status_code=404,
                detail="OpenMM setup requires AMBER files (.prmtop and .inpcrd/.rst) in input directory",
            )
        manager = OpenMMEquilibrationManager(input_dir)
        manager.setup_openmm_equilibration(
            system_files=system_files,
            stage_params_list=stage_params,
            selections=selections,
            output_name=str(output_dir),
            scheme_type=_normalize_ensemble(payload.ensemble),
            add_com_restraint=payload.add_com_restraint,
            com_selection=payload.com_selection,
            com_restraint_k=payload.com_restraint_k,
            add_rotation_restraint=payload.add_rotation_restraint,
        )
        run_script = output_dir / "run_equilibration.sh"
        if run_script.exists():
            content = run_script.read_text()
            content = content.replace(
                'PYTHON="${PYTHON:-python}"',
                f'PYTHON="${{PYTHON:-{resolved_exec}}}"',
            )
            if payload.openmm_platform:
                content = content.replace(
                    'PLATFORM="${PLATFORM:-}"',
                    f'PLATFORM="${{PLATFORM:-{payload.openmm_platform}}}"',
                )
            run_script.write_text(content)
        return

    if "prmtop" not in system_files or "inpcrd" not in system_files:
        raise HTTPException(
            status_code=404,
            detail="NAMD setup requires AMBER files (.prmtop and .inpcrd/.rst) in input directory",
        )

    manager = NAMDEquilibrationManager(input_dir, resolved_exec)
    from gatewizard.tools.namd_water import read_water_model_from_builder_status

    water_model = payload.water_model or read_water_model_from_builder_status(
        input_dir
    )
    scheme_type = _normalize_ensemble(payload.ensemble)
    manager.setup_namd_equilibration(
        system_files=system_files,
        stage_params_list=stage_params,
        output_name=str(output_dir),
        scheme_type=scheme_type,
        namd_executable=resolved_exec,
        add_com_restraint=payload.add_com_restraint,
        com_selection=payload.com_selection,
        com_restraint_k=payload.com_restraint_k,
        add_rotation_restraint=payload.add_rotation_restraint,
        rotation_restraint_k=payload.rotation_restraint_k,
        water_model=water_model,
    )


@app.post("/generate-com-restraint")
def generate_com_restraint(payload: GenerateComRestraintRequest) -> dict:
    input_dir = Path(os.path.abspath(os.path.expanduser(payload.input_dir)))
    output_dir = Path(os.path.abspath(os.path.expanduser(payload.output_dir)))
    engine = payload.program_config.engine.lower().strip()
    executable = payload.program_config.executable.strip()

    if not input_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Directory not found: {input_dir}")
    output_dir.mkdir(parents=True, exist_ok=True)

    if engine == "namd":
        resolved_exec = _executable_for_equilibration_setup(
            engine, executable, require_on_path=False
        )
    else:
        resolved_exec = _resolve_executable(executable)
        if not resolved_exec:
            raise HTTPException(
                status_code=400, detail=f"Executable not found: {executable}"
            )

    pdb_path = output_dir / "system.pdb"
    if not pdb_path.exists():
        candidate = _find_preferred_system_pdb(input_dir)
        if candidate:
            pdb_path = candidate

    if not pdb_path.exists():
        raise HTTPException(
            status_code=404, detail="No PDB file found for COM restraints"
        )

    if engine == "namd":
        manager = NAMDEquilibrationManager(output_dir, resolved_exec)
        out = manager.generate_com_colvars_config(
            pdb_path=pdb_path,
            output_file=output_dir / "com_restraint.col",
            com_restraint_k=payload.com_restraint_k,
            selection=payload.com_selection,
            add_rotation_restraint=payload.add_rotation_restraint,
            rotation_restraint_k=payload.rotation_restraint_k,
        )
    elif engine == "gromacs":
        if GROMACSEquilibrationManager is None:
            raise HTTPException(
                status_code=501,
                detail="GROMACS support is not available in this gatewizard installation",
            )
        manager = GROMACSEquilibrationManager(input_dir)
        out = manager.generate_com_colvars_config(
            pdb_path=pdb_path,
            output_file=output_dir / "com_restraint.dat",
            com_restraint_k=payload.com_restraint_k,
            selection=payload.com_selection,
            add_rotation_restraint=payload.add_rotation_restraint,
            rotation_restraint_k=payload.rotation_restraint_k,
        )
    elif engine == "openmm":
        out = _write_openmm_com_params(
            pdb_path=pdb_path,
            output_dir=output_dir,
            com_selection=payload.com_selection,
            com_restraint_k=payload.com_restraint_k,
            add_rotation_restraint=payload.add_rotation_restraint,
        )
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported engine: {engine}")

    if out is None:
        raise HTTPException(status_code=400, detail="COM restraint generation failed")

    return {"output": str(out), "engine": engine}


_ENGINE_EXECUTABLES: dict[str, list[str]] = {
    "namd": ["namd3", "namd2", "namd"],
    "gromacs": ["gmx", "gmx_mpi", "mdrun", "gmx_seq"],
    "openmm": ["python", "python3"],
}


def _find_engine_pid(workdir: Path, engine: str) -> int | None:
    """Scan /proc to find a running MD engine process whose cmdline mentions workdir."""
    targets = set(_ENGINE_EXECUTABLES.get(engine.lower(), []))
    workdir_str = str(workdir)
    try:
        for entry in Path("/proc").iterdir():
            if not entry.name.isdigit():
                continue
            pid = int(entry.name)
            cmdline_file = entry / "cmdline"
            try:
                cmdline = (
                    cmdline_file.read_bytes()
                    .replace(b"\x00", b" ")
                    .decode("utf-8", errors="replace")
                    .strip()
                )
            except OSError:
                continue
            if workdir_str not in cmdline:
                continue
            # Match executable name
            exe_file = entry / "exe"
            try:
                exe_name = Path(os.readlink(exe_file)).name
            except OSError:
                exe_name = Path(cmdline.split()[0]).name if cmdline else ""
            if any(t == exe_name or exe_name.startswith(t) for t in targets):
                return pid
    except OSError:
        pass
    return None


def _resolve_pid(workdir: Path, engine: str) -> int | None:
    """Return the best available PID for the given workdir: pid file first, then /proc scan."""
    pid_file = workdir / "equilibration.pid"
    if pid_file.exists():
        try:
            pid = int(pid_file.read_text().strip())
            os.kill(pid, 0)
            return pid
        except (ValueError, OSError):
            pass  # pid file stale — fall through to scan
    return _find_engine_pid(workdir, engine)


def is_equilibration_process_running(workdir: Path, engine: str = "") -> bool:
    """Return True if an MD process is running for this workdir.

    NOTE: intentionally does NOT delete the pid file — that avoids a race
    where repeated polling wipes the file before stop/process-info can read it.
    """
    return _pid_file_alive(workdir) or (
        bool(engine) and _find_engine_pid(workdir, engine) is not None
    )


# Real failure markers from engine logs / run_equilibration.sh — NOT bare
# "error" (GROMACS unused-macro warnings say "spelling error").
_EQ_FAILURE_RE = re.compile(
    r"(?i)"
    r"("
    r"fatal error:"
    r"|error in user input:"
    r"|error in stage\b"
    r"|error: namd executable"
    r"|minimisation failed"
    r"|minimization failed"
    r"|production failed"
    r"|stage\s+\d+.*failed"
    r"|equilibration failed"
    r"|command not found"
    r"|segmentation fault"
    r")"
)


def _equilibration_log_failure_line(text: str) -> str | None:
    """Return the first line that indicates a real MD failure, else None."""
    for line in text.splitlines():
        if _EQ_FAILURE_RE.search(line):
            return line.strip() or line
    return None


def _pid_file_alive(workdir: Path) -> bool:
    """Check only the pid file (any executable)."""
    pid_file = workdir / "equilibration.pid"
    if not pid_file.exists():
        return False
    try:
        pid = int(pid_file.read_text().strip())
        os.kill(pid, 0)
        return True
    except (ValueError, OSError):
        return False


def wait_on_child_process(proc: subprocess.Popen) -> None:
    """Wait on the shell launcher child so exited processes do not stay zombies."""
    proc.wait()


class EquilibrationRequest(BaseModel):
    working_dir: Path = Field(description="Absolute path to the working directory")
    engine: str = Field(description="Engine name")


class StructuralAnalysisRequest(BaseModel):
    topology_path: str = Field(..., description="Absolute path to topology file")
    trajectory_paths: list[str] = Field(
        ..., description="Absolute paths to trajectory files"
    )
    analysis_type: str = Field(
        ...,
        description=(
            "rmsd, rmsf, distance, radius_of_gyration, "
            "area_per_lipid, membrane_thickness"
        ),
    )
    selection: str = Field("protein and backbone", description="MDAnalysis selection")
    selection2: str = Field("", description="Second selection for distance analysis")
    reference_frame: int = Field(0, description="Reference frame for RMSD")
    align: bool = Field(True, description="Align structures before RMSD")
    file_times: dict[str, float] | None = Field(
        None, description="Optional per-file durations in ns"
    )
    rmsf_xaxis_type: str = Field(
        "residue_number",
        description="residue_number, residue_type_number, or atom_index",
    )
    leaflet_lipid_sel: str | None = Field(
        None, description="Leaflet assignment selection for bilayer analysis"
    )
    leaflet_filter_sel: str | None = Field(
        None,
        description="Optional leaflet filter selection (membrane thickness only)",
    )
    n_bins: int = Field(1, description="Grid bins for membrane thickness analysis")
    interpolate: bool = Field(
        False, description="Interpolate missing grid values (membrane thickness)"
    )
    start: int | None = Field(None, description="First trajectory frame (inclusive)")
    stop: int | None = Field(None, description="Last trajectory frame (exclusive)")
    step: int | None = Field(None, description="Trajectory frame stride")


class AnalyzeTopologyRequest(BaseModel):
    topology_path: str = Field(..., description="Absolute path to topology file")


_PROTEIN_RESIDUES = {
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
    "HIE",
    "HID",
    "HIP",
    "CYX",
    "HSD",
    "HSE",
    "HSP",
    "ACE",
    "NME",
}
_NUCLEIC_RESIDUES = {
    "A",
    "T",
    "G",
    "C",
    "U",
    "DA",
    "DT",
    "DG",
    "DC",
    "ADE",
    "THY",
    "GUA",
    "CYT",
    "URA",
    "RA",
    "RU",
    "RG",
    "RC",
}
_WATER_RESIDUES = {"WAT", "HOH", "TIP3", "TIP4", "TIP5", "SPC", "SOL", "H2O"}
_ION_RESIDUES = {
    "NA",
    "NA+",
    "CL",
    "CL-",
    "K",
    "K+",
    "MG",
    "MG2+",
    "CA",
    "CA2+",
    "ZN",
    "ZN2+",
    "FE",
    "FE2+",
    "FE3+",
    "CU",
    "CU2+",
    "MN",
    "MN2+",
    "CS",
    "CS+",
    "RB",
    "RB+",
    "LI",
    "LI+",
    "BR",
    "BR-",
    "F",
    "F-",
    "IOD",
    "I",
    "BA",
    "BA2+",
    "SR",
    "SR2+",
}
_LIPID_NAMES = {
    "POPC",
    "POPE",
    "DPPC",
    "DLPC",
    "DMPC",
    "DSPC",
    "DOPC",
    "DOPE",
    "DPPS",
    "DOPS",
    "POPS",
    "CHOL",
    "CHL1",
    "POPA",
    "POPE",
    "POPG",
    "DPPG",
    "DLPE",
    "DLPS",
    "DLPG",
    "PSM",
    "DPCE",
    "DPSM",
    "BNSM",
    "PNSM",
    "SSM",
}


@app.post("/analyze-topology")
def analyze_topology(payload: AnalyzeTopologyRequest) -> dict:
    top = Path(os.path.abspath(os.path.expanduser(payload.topology_path)))
    if not top.is_file():
        raise HTTPException(status_code=404, detail=f"Topology file not found: {top}")
    try:
        u = _load_structure_for_headgroup_detection(top)
        segments = []
        for seg in u.segments:
            segments.append(
                {
                    "segid": str(seg.segid),
                    "n_residues": len(seg.residues),
                    "n_atoms": len(seg.atoms),
                }
            )

        # Residue classification
        categories: dict[str, list] = {
            "Protein": [],
            "Nucleic": [],
            "Water": [],
            "Ions": [],
            "Lipids": [],
            "Other": [],
        }
        for residue in u.residues:
            rn = str(residue.resname).upper()
            info = {
                "name": residue.resname,
                "resid": int(residue.resid),
                "chain": str(residue.segid),
                "n_atoms": len(residue.atoms),
            }
            if rn in _PROTEIN_RESIDUES:
                categories["Protein"].append(info)
            elif rn in _WATER_RESIDUES:
                categories["Water"].append(info)
            elif rn in _ION_RESIDUES:
                categories["Ions"].append(info)
            elif rn in _LIPID_NAMES or "LIP" in rn:
                categories["Lipids"].append(info)
            elif rn in _NUCLEIC_RESIDUES:
                categories["Nucleic"].append(info)
            else:
                categories["Other"].append(info)

        # Per-category counts grouped by residue name
        category_summary = {}
        for cat, residues in categories.items():
            if not residues:
                continue
            by_name: dict[str, int] = {}
            for r in residues:
                by_name[r["name"]] = by_name.get(r["name"], 0) + 1
            category_summary[cat] = {
                "total_residues": len(residues),
                "total_atoms": sum(r["n_atoms"] for r in residues),
                "by_name": by_name,
            }

        residue_types = sorted(set(str(r) for r in u.residues.resnames))

        return {
            "n_atoms": len(u.atoms),
            "n_residues": len(u.residues),
            "n_segments": len(u.segments),
            "segments": segments,
            "residue_types": residue_types,
            "categories": category_summary,
            **_detect_lipid_headgroup_selection(u),
        }
    except Exception as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex


class DetectLipidHeadgroupsRequest(BaseModel):
    topology_path: str = Field(..., description="Absolute path to topology file")
    trajectory_paths: list[str] | None = Field(
        None, description="Optional trajectory paths (recommended for prmtop/psf)"
    )


@app.post("/detect-lipid-headgroups")
def detect_lipid_headgroups(payload: DetectLipidHeadgroupsRequest) -> dict:
    top = Path(os.path.abspath(os.path.expanduser(payload.topology_path)))
    if not top.is_file():
        raise HTTPException(status_code=404, detail=f"Topology file not found: {top}")
    trajs = [
        Path(os.path.abspath(os.path.expanduser(p)))
        for p in (payload.trajectory_paths or [])
    ]
    try:
        u = _load_structure_for_headgroup_detection(top, trajs or None)
        return _detect_lipid_headgroup_selection(u)
    except Exception as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex


class EnergeticColumnsRequest(BaseModel):
    log_paths: list[str] = Field(..., description="Absolute paths to log files")
    file_times: dict[str, float] | None = Field(
        None, description="Optional per-file durations in ns"
    )
    engine: str = Field("namd", description="Engine: namd, openmm, or gromacs")


class EnergeticAnalysisRequest(BaseModel):
    log_paths: list[str] = Field(..., description="Absolute paths to log files")
    properties: list[str] | None = Field(
        None, description="Properties to analyze (e.g., Total Energy, Temperature)"
    )
    file_times: dict[str, float] | None = Field(
        None, description="Optional per-file durations in ns"
    )
    time_units: str = Field("ns", description="ns, ps, or µs")
    energy_units: str = Field("kcal/mol", description="kcal/mol or kJ/mol")
    pressure_units: str = Field("atm", description="Pressure units")
    temperature_units: str = Field("K", description="Temperature units")
    volume_units: str = Field("Å³", description="Volume units")
    engine: str = Field("namd", description="Engine: namd, openmm, or gromacs")


@app.post("/get-equilibration-status")
def get_equilibration_status(payload: EquilibrationRequest) -> dict:
    workdir = Path(os.path.abspath(os.path.expanduser(payload.working_dir)))
    engine = payload.engine.lower().strip()

    response: dict[str, Any] = {
        "status": "not_started",
        "stages": [],
        "output": "",
        "run_start_time": None,
    }

    if not workdir.is_dir() or not (workdir / "run_equilibration.sh").exists():
        response["status"] = "empty"
        return response

    # Read persisted start time if available
    start_time_file = workdir / "equilibration_start_time.txt"
    if start_time_file.exists():
        try:
            response["run_start_time"] = start_time_file.read_text(
                encoding="utf-8"
            ).strip()
        except Exception:
            pass

    if not next(workdir.glob("*.log"), None):
        return response

    log_file = workdir / "equilibration_background.log"
    if log_file.exists():
        with open(log_file, "r") as file:
            response["output"] = file.read()

    match engine:
        case "namd":
            stage_data = namd_analysis.get_equilibration_progress(workdir)
        case "gromacs":
            stage_data = gromacs_analysis.get_equilibration_progress(workdir)
        case "openmm":
            stage_data = openmm_analysis.get_equilibration_progress(workdir)
        case _:
            raise HTTPException(
                status_code=400, detail=f"Unsupported engine: {payload.engine}"
            )

    for info in stage_data.values():
        # TODO: fix namd timing to ignore minimize in total steps
        data = dict(
            name=info.stage_name.replace("_", " ").title(),
            output="",
            performance=None,
            elapsed_time_seconds=None,
            simulated_time=None,
            status=info.status,
            total_simulation_time=None,
        )

        timing = info.timing
        if timing:
            data["performance"] = timing.ns_per_day
            data["simulated_time"] = timing.steps_completed * timing.timestep_fs * 1e-6
            data["total_simulation_time"] = (
                timing.total_steps * timing.timestep_fs * 1e-6
            )
            if timing.ns_per_day and timing.ns_per_day > 0:
                # Convert simulated ns and throughput (ns/day) to elapsed wall time.
                data["elapsed_time_seconds"] = (
                    data["simulated_time"] / timing.ns_per_day
                ) * 86400

        if info.log_file:
            with open(info.log_file, "r") as file:
                data["output"] = "".join(deque(file, maxlen=15))

        response["stages"].append(data)

    if is_equilibration_process_running(workdir, engine):
        response["status"] = "running"
    elif response["stages"] and any(
        info["status"] == "error" for info in response["stages"]
    ):
        response["status"] = "error"
    elif response["stages"] and all(
        info["status"] == "completed" for info in response["stages"]
    ):
        response["status"] = "completed"
    elif engine in {"gromacs", "openmm"}:
        # Do not treat bare "error" as failure — GROMACS unused-macro
        # warnings include the phrase "spelling error".
        if _equilibration_log_failure_line(response["output"]):
            response["status"] = "error"
        else:
            output_lower = response["output"].lower()
            if "complete" in output_lower or "finished" in output_lower:
                response["status"] = "completed"

    return response


@app.post("/run-equilibration")
def run_equilibration(payload: EquilibrationRequest) -> None:
    workdir = Path(os.path.abspath(os.path.expanduser(payload.working_dir)))
    if not workdir.is_dir():
        raise HTTPException(status_code=404, detail=f"Directory not found: {workdir}")

    script_file = workdir / "run_equilibration.sh"
    if not script_file.exists():
        raise HTTPException(status_code=404, detail="Script file not found")

    if sys.platform == "win32":
        raise HTTPException(status_code=500, detail="Windows is not supported")

    log_file = workdir / "equilibration_background.log"
    process = subprocess.Popen(
        ["nohup", "bash", str(script_file)],
        cwd=workdir,
        stdout=open(log_file, "w"),
        stderr=subprocess.STDOUT,
        preexec_fn=os.setsid,  # Create new session to detach from parent
    )
    threading.Thread(
        target=wait_on_child_process,
        args=(process,),
        daemon=True,
    ).start()

    pid_file = workdir / "equilibration.pid"
    with open(pid_file, "w") as file:
        file.write(str(process.pid))

    # Persist wall-clock start time so the GUI can show elapsed time even
    # after an app restart.
    from datetime import datetime, timezone

    start_time_file = workdir / "equilibration_start_time.txt"
    start_time_file.write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")


@app.post("/stop-equilibration")
def stop_equilibration(payload: EquilibrationRequest) -> dict:
    workdir = Path(os.path.abspath(os.path.expanduser(payload.working_dir)))
    engine = payload.engine.lower().strip()

    pid = _resolve_pid(workdir, engine)
    if pid is None:
        raise HTTPException(
            status_code=404,
            detail="No running equilibration process found (checked pid file and /proc scan)",
        )

    stopped = False
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            # Kill the whole process group so bash + engine are both terminated
            pgid = os.getpgid(pid)
            os.killpg(pgid, sig)
            stopped = True
            break
        except ProcessLookupError:
            stopped = True  # Already dead
            break
        except (OSError, PermissionError):
            # pgid lookup failed — try killing just the pid
            try:
                os.kill(pid, sig)
                stopped = True
                break
            except (ProcessLookupError, PermissionError):
                stopped = True
                break

    pid_file = workdir / "equilibration.pid"
    pid_file.unlink(missing_ok=True)
    return {"stopped": stopped}


@app.post("/process-info")
def get_process_info(payload: EquilibrationRequest) -> dict:
    workdir = Path(os.path.abspath(os.path.expanduser(payload.working_dir)))
    engine = payload.engine.lower().strip()
    start_time_file = workdir / "equilibration_start_time.txt"

    result: dict[str, Any] = {
        "pid": None,
        "running": False,
        "command": None,
        "start_time": None,
        "working_dir": str(workdir),
        "engine": payload.engine,
    }

    if start_time_file.exists():
        try:
            result["start_time"] = start_time_file.read_text(encoding="utf-8").strip()
        except OSError:
            pass

    pid = _resolve_pid(workdir, engine)
    if pid is None:
        return result

    result["pid"] = pid
    result["running"] = True

    # Read command line from /proc on Linux
    cmdline_path = Path(f"/proc/{pid}/cmdline")
    if cmdline_path.exists():
        try:
            result["command"] = (
                cmdline_path.read_bytes()
                .replace(b"\x00", b" ")
                .decode("utf-8", errors="replace")
                .strip()
            )
        except OSError:
            pass

    return result


_BILAYER_ANALYSIS_TYPES = {
    "area_per_lipid",
    "apl",
    "membrane_thickness",
    "memb_thickness",
    "thickness",
}


def _normalize_analysis_type(analysis_type: str) -> str:
    return analysis_type.strip().lower().replace(" ", "_").replace("-", "_")


_PHOSPHATE_ATOM_NAME_RE = re.compile(r"^(PO4|P\d*)$", re.IGNORECASE)

_KNOWN_LIPID_HEADGROUP_NAMES = frozenset(
    {
        "PO4",
        "P",
        "P31",
        "P32",
        "P1",
        "P2",
        "P3",
        "GL1",
        "GL2",
        "ROH",
        "NC3",
        "C4B",
    }
)


def _is_lipid_headgroup_atom_name(name: str) -> bool:
    cleaned = str(name).strip()
    if not cleaned:
        return False
    if cleaned.upper() in _KNOWN_LIPID_HEADGROUP_NAMES:
        return True
    return bool(_PHOSPHATE_ATOM_NAME_RE.match(cleaned))


def _select_lipid_atoms(u: mda.Universe) -> mda.AtomGroup:
    """Return atoms belonging to lipids, using a broad fallback when names differ."""
    lipid_atoms = u.select_atoms(LIPID_SELECTION)
    if len(lipid_atoms) > 0:
        return lipid_atoms
    broad_sel = f"not (protein or nucleic or water or ({ION_SELECTION}))"
    return u.select_atoms(broad_sel)


def _headgroup_name_counts(atoms: mda.AtomGroup) -> list[dict[str, Any]]:
    from collections import Counter

    counts = Counter(str(name).strip() for name in atoms.names)
    detected: list[dict[str, Any]] = []
    for name, count in sorted(counts.items(), key=lambda item: (-item[1], item[0])):
        if _is_lipid_headgroup_atom_name(name):
            detected.append({"name": name, "atom_count": int(count)})
    return detected


def _detect_lipid_headgroup_atoms(u: mda.Universe) -> list[dict[str, Any]]:
    """Detect phosphate/headgroup atom names present in lipid residues."""
    lipid_atoms = _select_lipid_atoms(u)
    if len(lipid_atoms) == 0:
        return []

    detected = _headgroup_name_counts(lipid_atoms)
    if detected:
        return detected

    try:
        phosphorus = lipid_atoms.select_atoms("element P")
    except Exception:
        phosphorus = lipid_atoms[[str(e).upper() == "P" for e in lipid_atoms.elements]]

    if len(phosphorus) > 0:
        from collections import Counter

        counts = Counter(str(name).strip() for name in phosphorus.names)
        return [
            {"name": name, "atom_count": int(count)}
            for name, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
        ]

    return []


def _headgroup_selection_from_atom_names(names: list[str]) -> str:
    cleaned = [name.strip() for name in names if name.strip()]
    if not cleaned:
        return ""
    return "name " + " ".join(cleaned)


def _detect_lipid_headgroup_selection(u: mda.Universe) -> dict[str, Any]:
    atoms = _detect_lipid_headgroup_atoms(u)
    names = [entry["name"] for entry in atoms]
    return {
        "lipid_headgroup_atoms": atoms,
        "lipid_headgroup_selection": _headgroup_selection_from_atom_names(names),
    }


def _count_selection_atoms(u: mda.Universe, sel: str) -> int:
    try:
        return len(u.select_atoms(sel))
    except Exception as ex:
        raise ValueError(f"Invalid MDAnalysis selection '{sel}': {ex}") from ex


def _validate_bilayer_selections(
    topology: Path,
    trajectories: list[Path],
    lipid_sel: str,
    leaflet_lipid_sel: str | None = None,
    leaflet_filter_sel: str | None = None,
) -> None:
    """Ensure bilayer selections match atoms before calling lipyphilic."""
    u = _load_analysis_universe(topology, trajectories)

    n_lipid = _count_selection_atoms(u, lipid_sel)
    if n_lipid == 0:
        detected = _detect_lipid_headgroup_selection(u)
        combined = detected["lipid_headgroup_selection"]
        hint = (
            f" Detected from lipids: {combined!r}."
            if combined
            else " No phosphate/headgroup atom names were found in lipid residues."
        )
        raise ValueError(
            f"Lipid headgroup selection {lipid_sel!r} matched 0 atoms.{hint}"
        )

    if leaflet_lipid_sel:
        n_leaflet = _count_selection_atoms(u, leaflet_lipid_sel)
        if n_leaflet == 0:
            raise ValueError(
                f"Leaflet assignment selection {leaflet_lipid_sel!r} matched 0 atoms."
            )

    if leaflet_filter_sel:
        n_filter = _count_selection_atoms(u, leaflet_filter_sel)
        if n_filter == 0:
            raise ValueError(
                f"Leaflet filter selection {leaflet_filter_sel!r} matched 0 atoms."
            )


def _bilayer_analysis_error_message(exc: Exception, lipid_sel: str) -> str:
    msg = str(exc).strip()
    if "matched 0 atoms" in msg or "Invalid MDAnalysis selection" in msg:
        return msg
    if "zero-size array" in msg or "minimum which has no identity" in msg:
        return (
            "Bilayer analysis produced no usable data. Check the enabled phosphate "
            f"headgroup atom names (current selection: {lipid_sel!r}). The trajectory "
            "may not contain an equilibrated bilayer."
        )
    return msg or "Bilayer analysis failed."


@app.post("/analysis-structural")
def run_structural_analysis(payload: StructuralAnalysisRequest) -> dict:
    top = Path(os.path.abspath(os.path.expanduser(payload.topology_path)))
    if not top.is_file():
        raise HTTPException(status_code=404, detail=f"Topology file not found: {top}")

    trajs = [
        Path(os.path.abspath(os.path.expanduser(p))) for p in payload.trajectory_paths
    ]
    if not trajs:
        raise HTTPException(status_code=400, detail="No trajectory files provided")
    missing = [str(p) for p in trajs if not p.is_file()]
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"Trajectory file(s) not found: {', '.join(missing)}",
        )
    coord_trajs = _filter_coordinate_trajectories(top, trajs)
    if not coord_trajs:
        raise HTTPException(
            status_code=400,
            detail=(
                f"No coordinate trajectory files found. Topology {top.name!r} cannot "
                "be used as a trajectory. Add DCD, XTC, TRR, NC, or similar files."
            ),
        )

    try:
        atype = _normalize_analysis_type(payload.analysis_type)
        if atype in _BILAYER_ANALYSIS_TYPES:
            lipid_sel = (payload.selection or "").strip()
            if not lipid_sel:
                u = _load_analysis_universe(top, trajs)
                lipid_sel = _detect_lipid_headgroup_selection(u)[
                    "lipid_headgroup_selection"
                ] or "name PO4"
            _validate_bilayer_selections(
                top,
                trajs,
                lipid_sel,
                payload.leaflet_lipid_sel,
                payload.leaflet_filter_sel,
            )
            try:
                result = namd_analysis.run_bilayer_analysis(
                    topology_file=str(top),
                    trajectory_files=[str(p) for p in coord_trajs],
                    analysis_type=payload.analysis_type,
                    lipid_sel=lipid_sel,
                    leaflet_lipid_sel=payload.leaflet_lipid_sel,
                    leaflet_filter_sel=payload.leaflet_filter_sel,
                    n_bins=payload.n_bins,
                    interpolate=payload.interpolate,
                    file_times=payload.file_times,
                    start=payload.start,
                    stop=payload.stop,
                    step=payload.step,
                )
            except Exception as bilayer_ex:
                raise ValueError(
                    _bilayer_analysis_error_message(bilayer_ex, lipid_sel)
                ) from bilayer_ex
        else:
            result = namd_analysis.run_structural_analysis(
                topology_file=str(top),
                trajectory_files=[str(p) for p in coord_trajs],
                analysis_type=payload.analysis_type,
                selection=payload.selection,
                selection2=payload.selection2,
                reference_frame=payload.reference_frame,
                align=payload.align,
                file_times=payload.file_times,
                rmsf_xaxis_type=payload.rmsf_xaxis_type,
            )
        return sanitize_value(result)
    except Exception as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex


@app.post("/analysis-energetic-properties")
def list_energetic_properties(payload: EnergeticColumnsRequest) -> dict:
    logs = [Path(os.path.abspath(os.path.expanduser(p))) for p in payload.log_paths]
    if not logs:
        raise HTTPException(status_code=400, detail="No log files provided")
    missing = [str(p) for p in logs if not p.is_file()]
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"Log file(s) not found: {', '.join(missing)}",
        )
    engine = payload.engine.lower().strip()
    try:
        if engine == "openmm":
            props = openmm_analysis.list_openmm_energy_properties(
                [str(p) for p in logs], file_times=payload.file_times
            )
        elif engine == "gromacs":
            props = gromacs_analysis.list_gromacs_energy_properties(
                [str(p) for p in logs], file_times=payload.file_times
            )
        else:  # namd (default)
            props = namd_analysis.list_namd_energy_properties(
                [str(p) for p in logs], file_times=payload.file_times
            )
        return {"properties": props}
    except Exception as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex


@app.post("/analysis-energetic")
def run_energetic_analysis(payload: EnergeticAnalysisRequest) -> dict:
    logs = [Path(os.path.abspath(os.path.expanduser(p))) for p in payload.log_paths]
    if not logs:
        raise HTTPException(status_code=400, detail="No log files provided")
    missing = [str(p) for p in logs if not p.is_file()]
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"Log file(s) not found: {', '.join(missing)}",
        )
    engine = payload.engine.lower().strip()
    kwargs = dict(
        log_files=[str(p) for p in logs],
        properties=payload.properties,
        file_times=payload.file_times,
        time_units=payload.time_units,
        energy_units=payload.energy_units,
        pressure_units=payload.pressure_units,
        temperature_units=payload.temperature_units,
        volume_units=payload.volume_units,
    )
    try:
        if engine == "openmm":
            result = openmm_analysis.run_openmm_energetic_analysis(**kwargs)
        elif engine == "gromacs":
            result = gromacs_analysis.run_gromacs_energetic_analysis(**kwargs)
        else:  # namd (default)
            result = namd_analysis.run_energetic_analysis(**kwargs)
        return sanitize_value(result)
    except Exception as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex


def _ensure_output_folder(working_dir: str, output_folder_name: str) -> Path:
    """Create (if needed) an output folder under the project working directory."""
    base = Path(os.path.abspath(os.path.expanduser(working_dir)))
    folder_name = output_folder_name.strip()
    if not folder_name:
        raise HTTPException(status_code=400, detail="Output folder name cannot be empty")
    out = base / folder_name
    try:
        out.mkdir(parents=True, exist_ok=True)
    except OSError as ex:
        raise HTTPException(
            status_code=500,
            detail=f"Cannot create output folder ({out}): {ex}",
        ) from ex
    if not os.access(out, os.W_OK):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot write to output folder: {out}",
        )
    return out


def _resolve_preparation_workspace(
    working_dir: str | None,
    output_folder_name: str | None,
    source_path: str,
    *,
    default_prefix: str = "01_preparation",
) -> tuple[Path, Path]:
    """Return (job_dir, local_pdb) under working_dir, copying the source PDB when needed."""
    source = Path(os.path.abspath(os.path.expanduser(source_path)))
    if not source.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {source}")

    if not working_dir:
        return source.parent, source

    base = Path(os.path.abspath(os.path.expanduser(working_dir)))
    base.mkdir(parents=True, exist_ok=True)

    if output_folder_name and output_folder_name.strip():
        job_dir = base / output_folder_name.strip()
    else:
        job_dir = base / f"{default_prefix}_{source.stem}"

    job_dir.mkdir(parents=True, exist_ok=True)
    local_pdb = job_dir / source.name
    if source.resolve() != local_pdb.resolve() and not local_pdb.exists():
        shutil.copy2(source, local_pdb)
    elif local_pdb.exists():
        pass
    else:
        local_pdb = source

    return job_dir, local_pdb


def _protonated_output_path(job_dir: Path, input_pdb: Path) -> Path:
    """Standard protonated PDB name inside a preparation output folder."""
    stem = input_pdb.stem
    if stem.endswith("_capped"):
        stem = stem[: -len("_capped")]
    return job_dir / f"{stem}_protonated.pdb"


def _ensure_writable_output_file(output_path: str) -> Path:
    """Resolve output path and verify its parent directory can be created/written."""
    out = Path(os.path.abspath(os.path.expanduser(output_path)))
    parent = out.parent
    try:
        parent.mkdir(parents=True, exist_ok=True)
    except OSError as ex:
        raise HTTPException(
            status_code=500,
            detail=f"Cannot create output directory ({parent}): {ex}",
        ) from ex
    if not os.access(parent, os.W_OK):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot write to {parent}. Set a working directory with write access "
                "or move the input PDB to a writable folder."
            ),
        )
    return out


def _resolve_structure_save_dir(save_dir: str | None) -> Path:
    """Writable directory for RCSB PDB downloads (packaged macOS apps often have a read-only cwd)."""
    if save_dir:
        base = Path(os.path.abspath(os.path.expanduser(save_dir)))
    else:
        user_data = os.environ.get("GATEWIZARD_USER_DATA", "").strip()
        if user_data:
            base = Path(user_data) / "structures"
        else:
            base = Path.home() / "Documents" / "GateWizard"
    try:
        base.mkdir(parents=True, exist_ok=True)
    except OSError as ex:
        raise HTTPException(
            status_code=500,
            detail=f"Cannot create directory for PDB download ({base}): {ex}",
        ) from ex
    if not os.access(base, os.W_OK):
        raise HTTPException(
            status_code=500,
            detail=f"Directory is not writable: {base}",
        )
    return base


class StructureRequest(BaseModel):
    path: str = Field(..., description="Absolute path to a PDB/mmCIF file")
    topology: str | None = Field(description="Topology file name", default=None)
    selection: str | None = Field(
        description="MDAnalysis selection string", default=None
    )
    needs_bonds: bool = Field(False, description="Whether to guess bonds")
    needs_secondary_structure: bool = Field(
        False, description="Whether to get secondary structure"
    )
    save_dir: str | None = Field(
        None,
        description="Directory to save downloaded PDB files (uses app user data if omitted)",
    )


@app.post("/get-structure")
def get_structure(payload: StructureRequest) -> dict:
    if len(payload.path) == 4:  # PDB ID
        pdbid = payload.path.upper()
        try:
            url = f"https://files.rcsb.org/download/{pdbid.lower()}.pdb"
            resp = requests.get(url, timeout=15)
            resp.raise_for_status()

            base = _resolve_structure_save_dir(payload.save_dir)
            path = base / f"{pdbid.lower()}.pdb"
            path.write_text(resp.text, encoding="utf-8")
            payload.path = str(path)
        except requests.HTTPError as ex:
            raise HTTPException(
                status_code=400, detail=f"Failed to fetch PDB: {pdbid}"
            ) from ex
        except requests.RequestException as ex:
            raise HTTPException(
                status_code=400, detail=f"Failed to fetch PDB {pdbid}: {ex}"
            ) from ex
        except OSError as ex:
            raise HTTPException(
                status_code=500, detail=f"Failed to save PDB file: {ex}"
            ) from ex
    elif not os.path.isfile(payload.path):
        raise HTTPException(status_code=404, detail=f"File not found: {payload.path}")

    try:
        u = load_structure(payload.path, payload.topology, payload.needs_bonds)
    except Exception as ex:
        raise HTTPException(status_code=400, detail=f"Could not read structure: {ex}")

    n_atoms = int(u.atoms.n_atoms)
    if n_atoms == 0:
        raise HTTPException(status_code=400, detail="Empty structure")

    if payload.selection:
        sel = NAMED_SELECTIONS.get(payload.selection, payload.selection)
        try:
            atoms = u.select_atoms(sel)
        except mda.exceptions.SelectionError as ex:
            # Typing a selection in the UI can transiently produce incomplete expressions.
            # Return a validation-style error instead of an unhandled 500 traceback.
            raise HTTPException(status_code=422, detail=f"Invalid selection: {ex}")
        except Exception as ex:
            raise HTTPException(status_code=400, detail=f"Selection error: {ex}")
    else:
        atoms = u.atoms

    data = dict(path=payload.path)
    data["atoms"] = get_atoms(atoms)
    try:
        data["bonds"] = atoms.bonds.indices.tolist()
    except mda.exceptions.NoDataError:
        data["bonds"] = []
    if payload.needs_secondary_structure:
        atom_indices = {int(i) for i in atoms.indices}
        all_residues = get_residues(
            u, needs_secondary_structure=True, source_path=payload.path
        )
        data["residues"] = [
            r
            for r in all_residues
            if r.get("ca_index") is not None and int(r["ca_index"]) in atom_indices
        ]

    return data


class DetectMoleculesRequest(BaseModel):
    path: str = Field(..., description="Absolute path to a PDB/mmCIF file")


@app.post("/detect-molecules")
def detect_molecules(payload: DetectMoleculesRequest) -> list[dict]:
    u = load_structure(payload.path)

    datalist = []

    idxs = []
    for name in ["protein", "water", "lipid", "ion"]:
        atoms = u.select_atoms(NAMED_SELECTIONS[name])
        if len(atoms) == 0:
            continue
        data = dict(
            selection=name,
            atoms=get_atoms(atoms),
        )
        if name == "protein":
            protein_indices = {int(i) for i in atoms.indices}
            all_residues = get_residues(
                u, needs_secondary_structure=True, source_path=payload.path
            )
            data["residues"] = [
                r
                for r in all_residues
                if r.get("ca_index") is not None and int(r["ca_index"]) in protein_indices
            ]
        datalist.append(data)
        idxs.extend(atoms.indices)

    atoms = u.atoms.select_atoms(f"not (index {' '.join(map(str, idxs))})")
    for resname in set(res.resname for res in atoms.residues):
        residues = atoms.select_atoms(f"resname {resname}")
        if len(residues) == 0:
            continue
        datalist.append(
            dict(
                selection=f"resname {resname}",
                atoms=get_atoms(residues),
            )
        )

    return datalist


# ---------------------------------------------------------------------------
# Structure editing endpoints
# ---------------------------------------------------------------------------


def _mv_edit(pdb_path: str, operation) -> dict:
    """Load pdb_path into StructureManager, run operation(mv), save temp PDB, return atoms dict."""
    mv = StructureManager()
    mv.load_structure(pdb_path)
    operation(mv)
    fd, tmp_path = tempfile.mkstemp(suffix=".pdb")
    os.close(fd)
    mv.save_pdb(tmp_path)
    u = mda.Universe(tmp_path)
    data: dict = {"path": tmp_path, "atoms": get_atoms(u.atoms)}

    # Try to get bonds from the cached source universe first (transforms don't
    # change connectivity, so re-guessing on the new temp file is wasteful).
    src_key = str(Path(pdb_path).resolve())
    bonds: list = []
    src_had_bonds = False
    with FILE_CACHE_LOCK:
        src_entry = FILE_CACHE.get(src_key)
        if src_entry and src_entry.bond_guessed:
            try:
                bonds = src_entry.universe.atoms.bonds.indices.tolist()
                src_had_bonds = True
            except mda.exceptions.NoDataError:
                pass

    if not src_had_bonds:
        try:
            bonds = u.atoms.bonds.indices.tolist()
        except mda.exceptions.NoDataError:
            bonds = []

    data["bonds"] = bonds

    # Pre-populate the cache for the new temp file so future getStructure calls
    # with needs_bonds=True don't re-run the expensive guess_bonds().
    try:
        tmp_stat = Path(tmp_path).stat()
        new_entry = FileCacheEntry(
            mtime=tmp_stat.st_mtime, size=tmp_stat.st_size, universe=u
        )
        if src_had_bonds and bonds:
            # Transfer bond topology so the universe already has bonds
            try:
                u.add_TopologyAttr("bonds", [tuple(b) for b in bonds])
            except Exception:
                pass
        new_entry.bond_guessed = src_had_bonds
        tmp_key = str(Path(tmp_path).resolve())
        with FILE_CACHE_LOCK:
            FILE_CACHE[tmp_key] = new_entry
    except Exception:
        pass  # Non-critical; cache population is best-effort

    return data


class EditRenameChainRequest(BaseModel):
    path: str
    old_chain: str
    new_chain: str


@app.post("/edit/rename-chain")
def edit_rename_chain(payload: EditRenameChainRequest) -> dict:
    try:
        return _mv_edit(
            payload.path,
            lambda mv: mv.rename_chain(
                payload.old_chain.strip(), payload.new_chain.strip()
            ),
        )
    except (StructureError, ValueError) as exc:
        raise HTTPException(400, str(exc))


class EditRenameResiduesRequest(BaseModel):
    path: str
    chain_id: str
    start: int
    end: int
    new_name: str


@app.post("/edit/rename-residues")
def edit_rename_residues(payload: EditRenameResiduesRequest) -> dict:
    try:
        return _mv_edit(
            payload.path,
            lambda mv: mv.rename_residues(
                payload.chain_id, payload.start, payload.end, payload.new_name
            ),
        )
    except (StructureError, ValueError) as exc:
        raise HTTPException(400, str(exc))


class EditRenumberResiduesRequest(BaseModel):
    path: str
    chain_id: str
    start: int
    end: int
    new_start: int = 1


@app.post("/edit/renumber-residues")
def edit_renumber_residues(payload: EditRenumberResiduesRequest) -> dict:
    try:
        return _mv_edit(
            payload.path,
            lambda mv: mv.renumber_residues(
                payload.chain_id, payload.start, payload.end, payload.new_start
            ),
        )
    except (StructureError, ValueError) as exc:
        raise HTTPException(400, str(exc))


class EditDeleteAtomsRequest(BaseModel):
    path: str
    selection: str  # MDAnalysis selection string or named shorthand


@app.post("/edit/delete-atoms")
def edit_delete_atoms(payload: EditDeleteAtomsRequest) -> dict:
    """Delete atoms matching a selection and return the updated structure."""
    try:
        # Resolve named shorthand → MDAnalysis expression
        sel_str = NAMED_SELECTIONS.get(payload.selection, payload.selection)
        u_orig = load_structure(payload.path)
        idx = u_orig.select_atoms(sel_str).indices.tolist()
        if not idx:
            raise HTTPException(400, "Selection matched no atoms")
        if len(idx) == u_orig.atoms.n_atoms:
            raise HTTPException(400, "Selection would delete all atoms")
        return _mv_edit(payload.path, lambda mv: mv.delete_atoms(idx))
    except HTTPException:
        raise
    except (StructureError, ValueError) as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(400, str(exc))


class EditDeleteByIndicesRequest(BaseModel):
    path: str
    indices: List[int]


@app.post("/edit/delete-by-indices")
def edit_delete_by_indices(payload: EditDeleteByIndicesRequest) -> dict:
    """Delete atoms by their MDAnalysis index list and return the updated structure."""
    try:
        if not payload.indices:
            raise HTTPException(400, "No indices provided")
        u_orig = load_structure(payload.path)
        if len(payload.indices) >= u_orig.atoms.n_atoms:
            raise HTTPException(400, "Cannot delete all atoms")
        return _mv_edit(payload.path, lambda mv: mv.delete_atoms(payload.indices))
    except HTTPException:
        raise
    except (StructureError, ValueError) as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(400, str(exc))


class EditTransformRequest(BaseModel):
    path: str
    rotate: dict | None = None  # {"angle": float, "axis": "x"|"y"|"z"}
    translate: List[float] | None = None  # [dx, dy, dz]


@app.post("/edit/transform")
def edit_transform(payload: EditTransformRequest) -> dict:
    try:

        def _apply(mv: StructureManager) -> None:
            if payload.translate:
                mv.translate_atoms([float(v) for v in payload.translate])
            if payload.rotate:
                mv.rotate_atoms(
                    float(payload.rotate["angle"]),
                    str(payload.rotate.get("axis", "z")).lower(),
                    center="selection",
                )

        return _mv_edit(payload.path, _apply)
    except (StructureError, ValueError) as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(400, str(exc))


class EditRenameChainByIndicesRequest(BaseModel):
    path: str
    indices: List[int]
    new_chain: str


@app.post("/edit/rename-chain-by-indices")
def edit_rename_chain_by_indices(payload: EditRenameChainByIndicesRequest) -> dict:
    try:
        return _mv_edit(
            payload.path,
            lambda mv: mv.rename_chain_by_indices(
                payload.indices, payload.new_chain.strip()
            ),
        )
    except (StructureError, ValueError) as exc:
        raise HTTPException(400, str(exc))


class EditRenameResiduesByIndicesRequest(BaseModel):
    path: str
    indices: List[int]
    new_name: str


@app.post("/edit/rename-residues-by-indices")
def edit_rename_residues_by_indices(
    payload: EditRenameResiduesByIndicesRequest,
) -> dict:
    try:
        return _mv_edit(
            payload.path,
            lambda mv: mv.rename_residues_by_indices(
                payload.indices, payload.new_name.strip()
            ),
        )
    except (StructureError, ValueError) as exc:
        raise HTTPException(400, str(exc))


class EditRenumberResiduesByIndicesRequest(BaseModel):
    path: str
    indices: List[int]
    new_start: int = 1


@app.post("/edit/renumber-residues-by-indices")
def edit_renumber_residues_by_indices(
    payload: EditRenumberResiduesByIndicesRequest,
) -> dict:
    try:
        return _mv_edit(
            payload.path,
            lambda mv: mv.renumber_residues_by_indices(
                payload.indices, payload.new_start
            ),
        )
    except (StructureError, ValueError) as exc:
        raise HTTPException(400, str(exc))


class EditSelectByStringRequest(BaseModel):
    path: str
    selection: str


@app.post("/edit/select-by-string")
def edit_select_by_string(payload: EditSelectByStringRequest) -> dict:
    """Return indices of atoms matching an MDAnalysis selection string."""
    try:
        u = load_structure(payload.path)
        ag = u.select_atoms(payload.selection)
        return {"indices": ag.indices.tolist(), "count": int(ag.n_atoms)}
    except Exception as exc:
        raise HTTPException(400, str(exc))


class EditSavePdbRequest(BaseModel):
    source: str
    dest: str


@app.post("/edit/save-pdb")
def edit_save_pdb(payload: EditSavePdbRequest) -> dict:
    try:
        shutil.copy2(payload.source, payload.dest)
        return {"path": payload.dest, "success": True}
    except Exception as exc:
        raise HTTPException(400, str(exc))


# ── Transform (enhanced) ──────────────────────────────────────────────


class TransformCountRequest(BaseModel):
    path: str
    selection: str


@app.post("/transform/count-selection")
def transform_count_selection(payload: TransformCountRequest) -> dict:
    """Return the number of atoms matching a MDAnalysis selection string."""
    try:
        mv = StructureManager()
        mv.load_structure(payload.path)
        sel_str = NAMED_SELECTIONS.get(payload.selection, payload.selection)
        indices = mv.select_atoms(sel_str)
        return {"count": len(indices), "total": len(mv.structure.atoms)}
    except Exception as exc:
        raise HTTPException(400, str(exc))


class TransformOperation(BaseModel):
    type: str  # 'rotate' | 'translate' | 'center' | 'align'
    # Rotate
    angle: float | None = None
    axis: str | None = None  # 'x' | 'y' | 'z'
    center: str = "selection"  # 'selection' | 'origin'
    # Translate
    dx: float = 0.0
    dy: float = 0.0
    dz: float = 0.0
    # Align
    target_axis: str | None = None
    secondary_selection: str | None = None
    secondary_axis: str | None = None
    apply_to: str | None = None  # MDAnalysis selection or None (all atoms)


class TransformRequest(BaseModel):
    path: str
    selection: str | None = None  # MDAnalysis selection (None = all atoms)
    op: TransformOperation


def _apply_mv_op(
    mv: StructureManager,
    selection: "str | None",
    op: TransformOperation,
) -> "list[int] | None":
    """Apply one transform operation to *mv*; returns affected indices or None."""
    sel_str = NAMED_SELECTIONS.get(selection, selection) if selection else None
    indices = mv.select_atoms(sel_str) if sel_str else None

    if op.type == "rotate":
        mv.rotate_atoms(
            op.angle or 0.0, op.axis or "z", indices=indices, center=op.center
        )
    elif op.type == "translate":
        mv.translate_atoms([op.dx, op.dy, op.dz], indices=indices)
    elif op.type == "center":
        mv.center_atoms(indices=indices)
    elif op.type == "align":
        primary = (
            indices if indices is not None else list(range(len(mv.structure.atoms)))
        )
        sec_indices = None
        if op.secondary_selection:
            sec_str = NAMED_SELECTIONS.get(
                op.secondary_selection, op.secondary_selection
            )
            sec_indices = mv.select_atoms(sec_str)
        apply_to = None
        if op.apply_to:
            apl_str = NAMED_SELECTIONS.get(op.apply_to, op.apply_to)
            apply_to = mv.select_atoms(apl_str)
        mv.align_to_axis(
            primary,
            target_axis=op.target_axis or "z",
            secondary_indices=sec_indices if sec_indices else None,
            secondary_axis=op.secondary_axis or None,
            apply_to=apply_to,
        )
    return indices


@app.post("/transform/preview")
def transform_preview(payload: TransformRequest) -> dict:
    """Return new atom positions after a transform without saving."""
    try:
        mv = StructureManager()
        mv.load_structure(payload.path)
        indices = _apply_mv_op(mv, payload.selection, payload.op)
        atoms = mv.structure.atoms
        positions = [
            [float(a.coord[0]), float(a.coord[1]), float(a.coord[2])] for a in atoms
        ]
        affected = len(indices) if indices is not None else len(atoms)
        return {"positions": positions, "affected_count": affected}
    except (StructureError, ValueError) as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(400, str(exc))


@app.post("/transform/apply")
def transform_apply(payload: TransformRequest) -> dict:
    """Apply a transform, save to temp PDB, return updated structure."""
    try:
        return _mv_edit(
            payload.path, lambda mv: _apply_mv_op(mv, payload.selection, payload.op)
        )
    except (StructureError, ValueError) as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(400, str(exc))


# ── MemPro orientation ─────────────────────────────────────────────────

_mempro_jobs: dict = {}  # job_id → {status, results, error, ...}


def _mempro_state_file(working_dir: str) -> str:
    return os.path.join(working_dir, ".mempro_job.json")


def _write_mempro_state(state_file: str, data: dict) -> None:
    tmp = state_file + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f)
    os.replace(tmp, state_file)


class MemProRunRequest(BaseModel):
    path: str
    working_dir: str | None = None
    n_cpus: int | None = None
    n_iters: int = 150
    grid_size: int = 36
    dual_membrane: bool = False
    peripheral: bool = False
    use_weights: bool = False
    flip: bool = False
    membrane_thickness: float | None = None


@app.post("/mempro/run")
def mempro_run(payload: MemProRunRequest) -> dict:
    """Start a MemPro orientation job asynchronously; returns job_id."""
    from datetime import datetime, timezone  # noqa: PLC0415
    from gatewizard.core.mempro import MemPrO  # noqa: PLC0415

    if not MemPrO.is_available():
        raise HTTPException(
            503,
            "mempro executable not found. Install with: "
            "pip install git+https://github.com/pstansfeld/MemPrO.git",
        )

    job_id = str(uuid.uuid4())
    start_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    params = {
        "path": payload.path,
        "n_cpus": payload.n_cpus,
        "n_iters": payload.n_iters,
        "grid_size": payload.grid_size,
        "dual_membrane": payload.dual_membrane,
        "peripheral": payload.peripheral,
        "use_weights": payload.use_weights,
        "flip": payload.flip,
        "membrane_thickness": payload.membrane_thickness,
    }

    if payload.working_dir:
        # Persistent path: detached subprocess that survives backend/app close
        state = {
            "job_id": job_id,
            "status": "running",
            "start_time": start_time,
            "params": params,
            "results": None,
            "error": None,
            "pid": None,
        }
        state_file = _mempro_state_file(payload.working_dir)
        _write_mempro_state(state_file, state)
        worker_script = os.path.join(os.path.dirname(__file__), "mempro_worker.py")
        proc = subprocess.Popen(
            [sys.executable, worker_script, state_file],
            start_new_session=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        state["pid"] = proc.pid
        _write_mempro_state(state_file, state)
        _mempro_jobs[job_id] = state
    else:
        # In-memory fallback (no working_dir — results lost on app close)
        _mempro_jobs[job_id] = {
            "job_id": job_id,
            "status": "running",
            "start_time": start_time,
            "results": None,
            "error": None,
        }

        def _run() -> None:
            try:
                mp = MemPrO()
                results = mp.run(
                    payload.path,
                    n_cpus=payload.n_cpus,
                    n_iters=payload.n_iters,
                    grid_size=payload.grid_size,
                    dual_membrane=payload.dual_membrane,
                    peripheral=payload.peripheral,
                    use_weights=payload.use_weights,
                    flip=payload.flip,
                    membrane_thickness=payload.membrane_thickness,
                )
                _mempro_jobs[job_id]["results"] = [
                    {
                        "rank": r.rank,
                        "relative_potential": r.relative_potential,
                        "hits_pct": r.hits_pct,
                        "rerank_potential": r.rerank_potential,
                        "rerank_depth": r.rerank_depth,
                        "rerank_value": r.rerank_value,
                        "pdb_path": r.pdb_path,
                    }
                    for r in results
                ]
                _mempro_jobs[job_id]["status"] = "done"
            except Exception as exc:
                _mempro_jobs[job_id]["status"] = "error"
                _mempro_jobs[job_id]["error"] = str(exc)

        threading.Thread(target=_run, daemon=True).start()

    return {"job_id": job_id, "start_time": start_time}


@app.get("/mempro/scan")
def mempro_scan(working_dir: str) -> dict:
    """Return persisted MemPro job state from the working directory, if any."""
    state_file = _mempro_state_file(working_dir)
    if not os.path.exists(state_file):
        return {"found": False}
    try:
        with open(state_file) as f:
            state = json.load(f)
    except Exception:
        return {"found": False}
    # If still marked running, verify the worker PID is actually alive
    if state.get("status") == "running":
        pid = state.get("pid")
        if pid:
            try:
                os.kill(pid, 0)
            except (ProcessLookupError, OSError):
                # Worker died without updating the state file (crash)
                state["status"] = "error"
                state["error"] = "Worker process terminated unexpectedly"
                _write_mempro_state(state_file, state)
    return {"found": True, **state}


@app.get("/mempro/status/{job_id}")
def mempro_status(job_id: str) -> dict:
    if job_id not in _mempro_jobs:
        raise HTTPException(404, f"MemPro job {job_id!r} not found")
    return _mempro_jobs[job_id]


class MemProApplyRequest(BaseModel):
    pdb_path: str
    source_path: str | None = None


@app.post("/mempro/apply")
def mempro_apply(payload: MemProApplyRequest) -> dict:
    """Apply a MemPro orientation to the loaded structure, preserving all molecules."""
    oriented_pdb = payload.pdb_path
    if not os.path.isfile(oriented_pdb):
        raise HTTPException(status_code=404, detail=f"File not found: {oriented_pdb}")

    source_path = (payload.source_path or "").strip()
    if source_path and os.path.isfile(source_path):
        try:
            return _mv_edit(
                source_path,
                lambda mv: mv.apply_mempro_orientation(oriented_pdb),
            )
        except (StructureError, MemProError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    # Fallback: load oriented MemPro output only (protein + dummy atoms).
    try:
        u = load_structure(oriented_pdb)
        data: dict = {"path": oriented_pdb, "atoms": get_atoms(u.atoms)}
        try:
            data["bonds"] = u.atoms.bonds.indices.tolist()
        except mda.exceptions.NoDataError:
            data["bonds"] = []
        return data
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ── Packmol cavity hydration ─────────────────────────────────────────────


class PackmolEstimateVolumeRequest(BaseModel):
    path: str
    box_min: list[float]
    box_max: list[float]
    solute_radius: float | None = None
    exclusion_mode: str | None = None
    grid_spacing: float | None = None
    atom_indices: list[int] | None = None


class PackmolPreviewInpRequest(BaseModel):
    path: str
    working_dir: str | None = None
    box_min: list[float]
    box_max: list[float]
    n_waters: int
    solute_radius: float | None = None
    exclusion_mode: str | None = None
    tolerance: float = 2.0
    nloop: int = 20
    grid_spacing: float | None = None


class PackmolHydrateCavityRequest(BaseModel):
    path: str
    working_dir: str
    output_folder_name: str
    box_min: list[float]
    box_max: list[float]
    n_waters: int | None = None
    solute_radius: float | None = None
    exclusion_mode: str | None = None
    tolerance: float = 2.0
    nloop: int = 20
    grid_spacing: float | None = None


class PackmolRunCustomRequest(BaseModel):
    inp_text: str
    working_dir: str
    output_folder_name: str
    inp_filename: str = "packmol_custom.inp"
    path: str | None = Field(
        None,
        description="Source structure PDB referenced by the custom input (staged into the run folder).",
    )


@app.get("/packmol/check")
def packmol_check() -> dict:
    from gatewizard.tools.packmol_hydration import check_packmol_available  # noqa: PLC0415

    return check_packmol_available()


@app.post("/packmol/estimate-volume")
def packmol_estimate_volume(payload: PackmolEstimateVolumeRequest) -> dict:
    from gatewizard.tools.packmol_hydration import (  # noqa: PLC0415
        PackmolHydrationError,
        estimate_cavity_volume,
    )

    if not os.path.isfile(payload.path):
        raise HTTPException(404, f"PDB not found: {payload.path}")
    try:
        result = estimate_cavity_volume(
            pdb_file=payload.path,
            box_min=payload.box_min,
            box_max=payload.box_max,
            solute_radius=payload.solute_radius,
            exclusion_mode=payload.exclusion_mode,
            grid_spacing=payload.grid_spacing,
            atom_indices=payload.atom_indices,
        )
        return result.as_dict()
    except (ValueError, PackmolHydrationError) as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/packmol/preview-inp")
def packmol_preview_inp(payload: PackmolPreviewInpRequest) -> dict:
    import tempfile  # noqa: PLC0415

    from gatewizard.tools.packmol_hydration import (  # noqa: PLC0415
        PackmolHydrationError,
        preview_hydrate_inp,
    )

    if not os.path.isfile(payload.path):
        raise HTTPException(404, f"PDB not found: {payload.path}")
    tmp_parent = payload.working_dir if payload.working_dir and os.path.isdir(payload.working_dir) else None
    try:
        with tempfile.TemporaryDirectory(dir=tmp_parent) as tmp:
            return preview_hydrate_inp(
                pdb_file=payload.path,
                job_dir=tmp,
                box_min=payload.box_min,
                box_max=payload.box_max,
                n_waters=payload.n_waters,
                solute_radius=payload.solute_radius,
                exclusion_mode=payload.exclusion_mode,
                tolerance=payload.tolerance,
                nloop=payload.nloop,
                grid_spacing=payload.grid_spacing,
            )
    except (ValueError, PackmolHydrationError) as exc:
        raise HTTPException(400, str(exc)) from exc


_HYDRATION_MARKER = "hydration.json"


def _write_hydration_marker(job_dir: str, marker: dict) -> None:
    """Persist a hydration-job metadata marker used to list hydration outputs."""
    from datetime import datetime, timezone  # noqa: PLC0415

    marker.setdefault("gatewizard_hydration", True)
    marker.setdefault("created", datetime.now(timezone.utc).isoformat())
    try:
        (Path(job_dir) / _HYDRATION_MARKER).write_text(
            json.dumps(marker, indent=2), encoding="utf-8"
        )
    except OSError:
        pass


@app.post("/packmol/hydrate-cavity")
def packmol_hydrate_cavity(payload: PackmolHydrateCavityRequest) -> dict:
    from gatewizard.tools.packmol_hydration import (  # noqa: PLC0415
        PackmolHydrationError,
        hydrate_cavity,
    )

    if not payload.working_dir:
        raise HTTPException(400, "working_dir is required")
    if not os.path.isfile(payload.path):
        raise HTTPException(404, f"PDB not found: {payload.path}")
    try:
        _ensure_output_folder(payload.working_dir, payload.output_folder_name)
        result = hydrate_cavity(
            pdb_file=payload.path,
            working_dir=payload.working_dir,
            output_folder_name=payload.output_folder_name,
            box_min=payload.box_min,
            box_max=payload.box_max,
            n_waters=payload.n_waters,
            solute_radius=payload.solute_radius,
            exclusion_mode=payload.exclusion_mode,
            tolerance=payload.tolerance,
            nloop=payload.nloop,
            grid_spacing=payload.grid_spacing,
        )
        data = result.as_dict()
        _write_hydration_marker(
            data.get("job_dir", ""),
            {
                "type": "hydrate",
                "source_pdb": payload.path,
                "output_pdb": data.get("output_pdb", ""),
                "output_pdb_name": os.path.basename(data.get("output_pdb", "")),
                "packmol_log": data.get("packmol_log", ""),
                "success": bool(data.get("success")),
                "message": data.get("message", ""),
                "box_min": list(payload.box_min),
                "box_max": list(payload.box_max),
                "n_waters": data.get("volumes", {}).get("suggested_waters")
                if payload.n_waters is None
                else payload.n_waters,
                "exclusion_mode": data.get("exclusion_mode"),
                "volumes": data.get("volumes"),
            },
        )
        return data
    except (ValueError, PackmolHydrationError) as exc:
        raise HTTPException(400, str(exc)) from exc


def _stage_custom_packmol_inputs(
    inp_text: str, job_dir: Path, source_pdb: str | None
) -> list[str]:
    """Copy structure files referenced by a custom PACKMOL input into ``job_dir``.

    The preview step generates job-relative filenames (the loaded structure PDB
    and ``TIP3P.pdb``) that only exist in a temporary preview directory. Copy the
    referenced files into the run folder so PACKMOL can find them; otherwise it
    aborts with "Could not find file".
    """
    referenced = re.findall(
        r"^\s*structure\s+(.+?)\s*$", inp_text, re.MULTILINE | re.IGNORECASE
    )
    tip3p_template: Path | None = None
    missing: list[str] = []
    for raw in referenced:
        name = raw.strip().strip('"')
        if not name:
            continue
        dest = job_dir / Path(name).name
        if dest.is_file():
            continue
        candidate = Path(os.path.expanduser(name))
        if candidate.is_file():
            shutil.copy2(candidate, dest)
            continue
        base = Path(name).name
        if (
            source_pdb
            and base == Path(source_pdb).name
            and os.path.isfile(source_pdb)
        ):
            shutil.copy2(source_pdb, dest)
            continue
        if base.lower() == "tip3p.pdb":
            if tip3p_template is None:
                from gatewizard.tools.packmol_hydration import (  # noqa: PLC0415
                    _resolve_tip3p_template,
                )

                tip3p_template = _resolve_tip3p_template()
            shutil.copy2(tip3p_template, dest)
            continue
        missing.append(name)
    return missing


@app.post("/packmol/run-custom")
def packmol_run_custom(payload: PackmolRunCustomRequest) -> dict:
    from gatewizard.tools.packmol_hydration import (  # noqa: PLC0415
        PackmolHydrationError,
        run_custom_packmol,
    )

    if not payload.working_dir:
        raise HTTPException(400, "working_dir is required")
    try:
        job_dir = _ensure_output_folder(
            payload.working_dir, payload.output_folder_name
        )
        missing = _stage_custom_packmol_inputs(
            payload.inp_text, job_dir, payload.path
        )
        if missing:
            raise HTTPException(
                400,
                "Custom PACKMOL input references files that could not be located: "
                + ", ".join(missing)
                + ". Regenerate the preset template or place the files in the output folder.",
            )
        result = run_custom_packmol(
            inp_text=payload.inp_text,
            working_dir=payload.working_dir,
            output_folder_name=payload.output_folder_name,
            inp_filename=payload.inp_filename,
        )
        _write_hydration_marker(
            result.get("job_dir", str(job_dir)),
            {
                "type": "custom",
                "source_pdb": payload.path,
                "output_pdb": result.get("output_pdb", ""),
                "output_pdb_name": os.path.basename(result.get("output_pdb", "")),
                "packmol_log": result.get("packmol_log", ""),
                "success": bool(result.get("success")),
                "message": result.get("message", ""),
            },
        )
        return result
    except (ValueError, PackmolHydrationError) as exc:
        raise HTTPException(400, str(exc)) from exc


class PackmolScanJobsRequest(BaseModel):
    working_dir: str


@app.post("/packmol/scan-jobs")
def packmol_scan_jobs(payload: PackmolScanJobsRequest) -> dict:
    """List hydration output folders (sub-dirs containing a hydration.json marker)."""
    base = Path(os.path.abspath(os.path.expanduser(payload.working_dir)))
    if not base.is_dir():
        return {"jobs": []}
    jobs: list[dict] = []
    for marker_file in base.glob(f"*/{_HYDRATION_MARKER}"):
        job_dir = marker_file.parent
        try:
            data = json.loads(marker_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not data.get("gatewizard_hydration"):
            continue
        output_pdb = data.get("output_pdb", "")
        data["job_dir"] = str(job_dir)
        data["name"] = job_dir.name
        data["output_exists"] = bool(output_pdb) and os.path.isfile(output_pdb)
        jobs.append(data)
    jobs.sort(key=lambda j: j.get("created") or "", reverse=True)
    return {"jobs": jobs}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
