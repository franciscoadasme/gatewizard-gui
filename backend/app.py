"""HTTP API for the GateWizard desktop app (spawned by Electron main process)."""

import base64
import os
import re
import requests
import shutil
import subprocess
import sys
import threading
import tempfile
import uuid
from collections import deque
from dataclasses import dataclass
from importlib import metadata
from pathlib import Path
from typing import List

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
import psique
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from gatewizard.utils.protein_capping import cap_protein
from gatewizard.core.viewer import MolecularViewer, ViewerError
from gatewizard.core.preparation import PreparationManager
from gatewizard.core.builder import Builder
from gatewizard.tools.equilibration import NAMDEquilibrationManager
from gatewizard.tools.force_fields import ForceFieldManager
from gatewizard.tools.ligand_parametrization import (
    detect_ligands,
    parametrize_ligand_from_system_pdb,
    get_ligand_2d_image,
    get_ligand_2d_image_from_pdb_lines,
)
from gatewizard.utils import namd_analysis

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
            chain_id=(
                str(it.segid).strip()
                or str(getattr(it, "chainID", "") or "").strip()
                or "A"
            ),
        )
        for it in atoms
    ]


def get_residues(
    u: mda.Universe, needs_secondary_structure: bool = False
) -> list[dict]:
    sec_segments = []
    if needs_secondary_structure:
        try:
            sec_segments = get_secondary_structure(u)
        except Exception:
            pass

    residue_sec_table: dict[tuple[str, int, str | None], str] = {}
    for sec in sec_segments:
        for resid in range(sec.start.number, sec.end.number + 1):
            # FIXME: Handle insertion codes
            residue_sec_table[(sec.start.chain, resid, None)] = sec.kind.value

    residues = []
    for res in u.residues:
        chain = str(res.segid).strip()
        if not chain:
            # Standard PDB: chain in chainID (col 22), segid is empty
            try:
                chain = str(res.atoms[0].chainID or "").strip()
            except (AttributeError, IndexError):
                pass
        chain = chain or "A"
        ca_atoms = res.atoms.select_atoms("name CA")
        residues.append(
            dict(
                chain=chain,
                resname=str(res.resname).strip(),
                number=int(res.resid),
                atom_indices=sorted(int(i) for i in res.atoms.indices.tolist()),
                sec=residue_sec_table.get((chain, res.resid, None)),
                ca_index=(int(ca_atoms.indices[0]) if ca_atoms.n_atoms == 1 else None),
            )
        )
    return residues


def get_secondary_structure(u: mda.Universe) -> list[psique.SecondaryStructure]:
    """Return the secondary structure of the universe."""
    with tempfile.NamedTemporaryFile("w", suffix=".pdb") as file:
        u.atoms.write(file.name)
        return psique.assign(file.name)


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
            u = mda.Universe(topology or path, path)
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


class DetectLigandsRequest(BaseModel):
    path: str = Field(..., description="Absolute path to a PDB/mmCIF file")


class ParametrizeLigandRequest(BaseModel):
    path: str = Field(..., description="Absolute path to a PDB/mmCIF file")
    ligand_name: str = Field(..., description="3-letter residue name of the ligand")
    charge: int = Field(0, description="Net charge of the ligand")
    multiplicity: int = Field(1, description="Spin multiplicity")


class ValidateBuilderRequest(BaseModel):
    path: str = Field(..., description="Absolute path to a PDB/mmCIF file")
    upper_lipids: List[str] = Field(..., description="Upper leaflet lipid names")
    lower_lipids: List[str] = Field(..., description="Lower leaflet lipid names")
    lipid_ratios: str = Field(
        ..., description="Lipid ratios as upper_ratios//lower_ratios"
    )


class StartPreparationRequest(BaseModel):
    path: str = Field(..., description="Absolute path to a PDB/mmCIF file")
    upper_lipids: List[str] = Field(..., description="Upper leaflet lipid names")
    lower_lipids: List[str] = Field(..., description="Lower leaflet lipid names")
    lipid_ratios: str = Field(..., description="Lipid ratios")
    water_model: str = "tip3p"
    protein_ff: str = "ff19SB"
    lipid_ff: str = "lipid21"
    preoriented: bool = True
    parametrize: bool = True
    salt_concentration: float = 0.15
    cation: str = "K+"
    anion: str = "Cl-"
    dist_wat: float = 17.5
    dims: List[float] | None = None
    output_folder_name: str | None = None
    ligand_params: list | None = None


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


@app.post("/run-propka")
def run_propka(payload: RunPropKaRequest) -> dict:
    path = os.path.abspath(os.path.expanduser(payload.path))
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    try:
        residue_renumbering_table = {}
        if payload.cap_protein:
            path, residue_renumbering_table = cap_protein(path)
            residue_renumbering_table = {
                "_".join(map(str, old)): new[2]  # (name, chain, id) -> new_id
                for old, new in residue_renumbering_table.items()
                if old != new
            }
        manager = PreparationManager(propka_version="3")
        pka_file = manager.run_analysis(path)
        summary_file = manager.extract_summary(pka_file)
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


@app.post("/parametrize-ligand")
def parametrize_ligand_endpoint(payload: ParametrizeLigandRequest) -> dict:
    path = os.path.abspath(os.path.expanduser(payload.path))
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
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


def _tleap_log_ok(log_path: Path) -> bool:
    """Return True if tleap finished with zero errors."""
    try:
        text = log_path.read_text()
        m = re.search(r"Exiting LEaP:\s*Errors\s*=\s*(\d+)", text)
        return m is not None and int(m.group(1)) == 0
    except OSError:
        return False


@app.post("/check-ligand-parametrization")
def check_ligand_param(payload: CheckParamRequest) -> dict:
    """Check which ligands already have frcmod/lib from a previous run."""
    pdb_dir = Path(os.path.abspath(os.path.expanduser(payload.pdb_path))).parent
    found = {}
    for name in payload.ligand_names:
        lig_dir = pdb_dir / "ligand_params" / name
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
    return {"parametrized": found}


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
        )
        return {"valid": is_valid, "error": error_msg}
    except Exception as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex


@app.post("/start-preparation")
def start_preparation(payload: StartPreparationRequest) -> dict:
    path = os.path.abspath(os.path.expanduser(payload.path))
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    working_dir = os.path.dirname(path)
    try:
        builder = Builder()
        builder.set_configuration(
            water_model=payload.water_model,
            protein_ff=payload.protein_ff,
            lipid_ff=payload.lipid_ff,
            preoriented=payload.preoriented,
            parametrize=payload.parametrize,
            salt_concentration=payload.salt_concentration,
            cation=payload.cation,
            anion=payload.anion,
            dist_wat=payload.dist_wat,
            dims=payload.dims,
            output_folder_name=payload.output_folder_name or None,
            ligand_params={
                lp["name"]: {"frcmod": lp["frcmod"], "lib": lp["lib"]}
                for lp in (payload.ligand_params or [])
            },
        )
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


@app.post("/detect-disulfide-bonds")
def detect_disulfide_bonds(payload: DetectDisulfideBondsRequest) -> dict:
    path = os.path.abspath(os.path.expanduser(payload.path))
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    manager = PreparationManager()
    disulfide_bonds = manager.detect_disulfide_bonds(
        path, payload.max_disulfide_distance
    )
    return {"disulfide_bonds": disulfide_bonds}


class PreparePDBRequest(BaseModel):
    path: str = Field(description="Absolute path to a PDB/mmCIF file")
    output_path: str = Field(description="Absolute path to the output PDB/mmCIF file")
    protonation_states: list[dict] = Field(description="Protonation states")
    target_ph: float = Field(description="Target pH")
    disulfide_bonds: list[tuple[tuple[str, int], tuple[str, int]]] = Field(
        description="Disulfide bonds"
    )


@app.post("/prepare-pdb")
def prepare_pdb(payload: PreparePDBRequest) -> None:
    path = os.path.abspath(os.path.expanduser(payload.path))
    output_path = os.path.abspath(os.path.expanduser(payload.output_path))
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    def get_residue_id(info: dict) -> str:
        resid = info["residue"] + str(info["res_id"])
        if info["chain"]:
            resid += "_" + info["chain"]
        return resid

    manager = PreparationManager()

    with tempfile.NamedTemporaryFile(suffix=".pdb", delete=True) as tmp:
        custom_states = {
            get_residue_id(info): info["current_state"]
            for info in payload.protonation_states
            if info["current_state"] != info["initial_state"]
        }
        manager.apply_protonation_states(
            path,
            tmp.name,
            payload.target_ph,
            custom_states,
            payload.protonation_states,
        )

        manager.apply_disulfide_bonds(tmp.name, tmp.name, payload.disulfide_bonds)

        result = manager.run_pdb4amber_with_cap_fix(
            input_pdb=tmp.name,
            output_pdb=output_path,
            fix_caps="capped" in path,
        )
        return dict(output=result["stdout"] + "\n" + result["stderr"])


class NAMDConfig(BaseModel):
    executable: str = Field(description="Path to the NAMD executable")


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
    program_config: NAMDConfig = Field(description="Program configuration")
    protocol: Protocol = Field(description="Simulation protocol")


@app.post("/generate-equilibration")
def generate_equilibration(payload: GenerateEquilibrationRequest) -> None:
    if not os.path.isdir(payload.input_dir):
        raise HTTPException(
            status_code=404, detail=f"Directory not found: {payload.input_dir}"
        )

    input_dir = Path(payload.input_dir)
    output_dir = Path(payload.output_dir)
    restraint_dir = output_dir / "restraints"

    restraint_dir.mkdir(parents=True, exist_ok=True)

    # Copy system files
    topology_files = list(input_dir.glob("*.prmtop"))
    topology_files += list(input_dir.glob("*.top"))
    if not topology_files:
        raise HTTPException(status_code=404, detail="No topology files found")
    shutil.copy2(topology_files[0], output_dir / "system.prmtop")

    crd_files = list(input_dir.glob("*.inpcrd"))
    crd_files += list(input_dir.glob("*.rst"))
    if not crd_files:
        raise HTTPException(status_code=404, detail="No coordinates files found")
    shutil.copy2(crd_files[0], output_dir / "system.inpcrd")

    pdb_files = list(input_dir.glob("*.pdb"))
    if pdb_files:
        # Prefer system.pdb by name (the full tleap-generated system), because the
        # input directory may also contain protein-only or intermediate PDB files that
        # would be selected first by a naive alphabetical glob.
        selected_pdb = next(
            (f for f in pdb_files if f.name.lower() == "system.pdb"), pdb_files[0]
        )
        shutil.copy2(selected_pdb, output_dir / "system.pdb")

    bilayer_pdb_files = list(input_dir.glob("bilayer*_lipid.pdb"))
    if bilayer_pdb_files:
        shutil.copy2(bilayer_pdb_files[0], output_dir)

    system_files = {
        "prmtop": "system.prmtop",
        "inpcrd": "system.inpcrd",
        "pdb": "system.pdb",
    }

    # Generate NAMD input files
    namd = NAMDEquilibrationManager(output_dir, payload.program_config.executable)
    prev_stage_key = None
    for i, stage in enumerate(payload.protocol.stages):
        stem = namd._get_config_name(stage.name, i)
        stem += "_equilibration" if stem != "step7_production" else ""

        stage_dump = stage.model_dump()
        stage_dump["constraints"] = {
            it.name: it.force_constant for it in stage.constraints
        }
        contents = namd.generate_charmm_gui_config_file(
            stage.name,
            stage_dump,
            i,
            system_files,
            payload.ensemble,
            prev_stage_key,
            {it.name: it.model_dump() for it in payload.protocol.stages},
            force_scheme_type=True,
        )
        if not contents.strip():
            raise HTTPException(
                status_code=500,
                detail=f"Failed to generate NAMD input file for stage {stage.name}",
            )
        with open(output_dir / f"{stem}.conf", "w") as file:
            file.write(contents)

        restraints = [it for it in stage.constraints if it.force_constant > 0]
        if restraints:
            namd.generate_restraints_file_mda(
                output_dir / system_files["pdb"],
                {it.name: (it.selection, it.force_constant) for it in restraints},
                restraint_dir / f"{stem}_restraints.pdb",
                stage.name,
            )

        prev_stage_key = stage.name

    namd.generate_restraints_file_mda(
        output_dir / system_files["pdb"],
        {
            it.name: (it.selection, it.force_constant)
            for it in payload.protocol.stages[0].constraints
        },
        restraint_dir / "restraints.pdb",
        "General",
    )

    script_file = output_dir / "run_equilibration.sh"
    with open(script_file, "w") as file:
        contents = namd.generate_run_script(
            {it.name: it.model_dump() for it in payload.protocol.stages},
            payload.program_config.executable,
        )
        file.write(contents)
    script_file.chmod(0o755)


def is_equilibration_process_running(workdir: Path) -> bool:
    pid_file = workdir / "equilibration.pid"
    if not pid_file.exists():
        return False

    with open(pid_file, "r") as file:
        pid = int(file.read().strip())

    try:
        os.kill(pid, 0)  # Send signal 0 to check if process exists
        return True
    except OSError:
        # Process doesn't exist, remove PID file
        pid_file.unlink()
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
        ..., description="rmsd, rmsf, distance, radius_of_gyration"
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
        u = load_structure(str(top))

        # Per-segment summary
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
        }
    except Exception as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex


class EnergeticColumnsRequest(BaseModel):
    log_paths: list[str] = Field(..., description="Absolute paths to NAMD log files")
    file_times: dict[str, float] | None = Field(
        None, description="Optional per-file durations in ns"
    )


class EnergeticAnalysisRequest(BaseModel):
    log_paths: list[str] = Field(..., description="Absolute paths to NAMD log files")
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


@app.post("/get-equilibration-status")
def get_equilibration_status(payload: EquilibrationRequest) -> dict:
    workdir = Path(os.path.abspath(os.path.expanduser(payload.working_dir)))

    response = dict(status="not_started", stages=[], output="")

    if not workdir.is_dir() or not next(workdir.glob("*.conf"), None):
        response["status"] = "empty"
        return response
    if not next(workdir.glob("*.log"), None):
        return response

    log_file = workdir / "equilibration_background.log"
    if log_file.exists():
        with open(log_file, "r") as file:
            response["output"] = file.read()

    match payload.engine:
        case "namd":
            stage_data = namd_analysis.get_equilibration_progress(workdir)
        case _:
            raise HTTPException(
                status_code=400, detail=f"Unsupported engine: {payload.engine}"
            )

    for info in sorted(stage_data.values(), key=lambda it: it.stage_name):
        # TODO: fix namd timing to ignore minimize in total steps
        data = dict(
            name=info.stage_name.replace("_", " ").title(),
            output="",
            performance=None,
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

        if info.log_file:
            with open(info.log_file, "r") as file:
                data["output"] = "".join(deque(file, maxlen=15))

        response["stages"].append(data)

    if is_equilibration_process_running(workdir):
        response["status"] = "running"
    elif any(info["status"] == "error" for info in response["stages"]):
        response["status"] = "error"
    elif all(info["status"] == "completed" for info in response["stages"]):
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

    try:
        result = namd_analysis.run_structural_analysis(
            topology_file=str(top),
            trajectory_files=[str(p) for p in trajs],
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
    try:
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

    try:
        result = namd_analysis.run_energetic_analysis(
            log_files=[str(p) for p in logs],
            properties=payload.properties,
            file_times=payload.file_times,
            time_units=payload.time_units,
            energy_units=payload.energy_units,
            pressure_units=payload.pressure_units,
            temperature_units=payload.temperature_units,
            volume_units=payload.volume_units,
        )
        return sanitize_value(result)
    except Exception as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex


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
        None, description="Directory to save downloaded PDB files (uses cwd if omitted)"
    )


@app.post("/get-structure")
def get_structure(payload: StructureRequest) -> dict:
    if len(payload.path) == 4:  # PDB ID
        try:
            pdbid = payload.path
            url = f"https://files.rcsb.org/download/{pdbid}.pdb"
            resp = requests.get(url, timeout=15)
            resp.raise_for_status()

            base = Path(payload.save_dir).resolve() if payload.save_dir else Path.cwd()
            base.mkdir(parents=True, exist_ok=True)
            path = base / f"{pdbid.lower()}.pdb"
            path.write_text(resp.text)
            payload.path = str(path)
        except requests.HTTPError as ex:
            raise HTTPException(400, f"Failed to fetch PDB: {pdbid}")
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
        data["residues"] = get_residues(u, needs_secondary_structure=True)

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
            data["residues"] = get_residues(atoms, needs_secondary_structure=True)
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
    """Load pdb_path into MolecularViewer, run operation(mv), save temp PDB, return atoms dict."""
    mv = MolecularViewer()
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
    except (ViewerError, ValueError) as exc:
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
    except (ViewerError, ValueError) as exc:
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
    except (ViewerError, ValueError) as exc:
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
    except (ViewerError, ValueError) as exc:
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
    except (ViewerError, ValueError) as exc:
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

        def _apply(mv: MolecularViewer) -> None:
            if payload.translate:
                mv.translate_atoms([float(v) for v in payload.translate])
            if payload.rotate:
                mv.rotate_atoms(
                    float(payload.rotate["angle"]),
                    str(payload.rotate.get("axis", "z")).lower(),
                    center="selection",
                )

        return _mv_edit(payload.path, _apply)
    except (ViewerError, ValueError) as exc:
        raise HTTPException(400, str(exc))
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
        mv = MolecularViewer()
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
    mv: MolecularViewer,
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
        mv = MolecularViewer()
        mv.load_structure(payload.path)
        indices = _apply_mv_op(mv, payload.selection, payload.op)
        atoms = mv.structure.atoms
        positions = [
            [float(a.coord[0]), float(a.coord[1]), float(a.coord[2])] for a in atoms
        ]
        affected = len(indices) if indices is not None else len(atoms)
        return {"positions": positions, "affected_count": affected}
    except (ViewerError, ValueError) as exc:
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
    except (ViewerError, ValueError) as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(400, str(exc))


# ── MemPro orientation ─────────────────────────────────────────────────

_mempro_jobs: dict = {}  # job_id → {status, results, error}


class MemProRunRequest(BaseModel):
    path: str
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
    from gatewizard.core.mempro import MemPrO  # noqa: PLC0415

    if not MemPrO.is_available():
        raise HTTPException(
            503,
            "mempro executable not found. Install with: "
            "pip install git+https://github.com/pstansfeld/MemPrO.git",
        )

    job_id = str(uuid.uuid4())
    _mempro_jobs[job_id] = {"status": "running", "results": None, "error": None}

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
    return {"job_id": job_id}


@app.get("/mempro/status/{job_id}")
def mempro_status(job_id: str) -> dict:
    if job_id not in _mempro_jobs:
        raise HTTPException(404, f"MemPro job {job_id!r} not found")
    return _mempro_jobs[job_id]


class MemProApplyRequest(BaseModel):
    pdb_path: str


@app.post("/mempro/apply")
def mempro_apply(payload: MemProApplyRequest) -> dict:
    """Load an oriented PDB file as the new current structure."""
    try:
        u = load_structure(payload.pdb_path)
        data: dict = {"path": payload.pdb_path, "atoms": get_atoms(u.atoms)}
        try:
            data["bonds"] = u.atoms.bonds.indices.tolist()
        except mda.exceptions.NoDataError:
            data["bonds"] = []
        return data
    except Exception as exc:
        raise HTTPException(400, str(exc))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
