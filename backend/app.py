"""HTTP API for the GateWizard desktop app (spawned by Electron main process)."""

import base64
import os
import re
import shutil
import subprocess
import sys
import threading
import tempfile
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


@dataclass
class FileCacheEntry:
    mtime: int
    size: int
    universe: mda.Universe


FILE_CACHE: dict[str, FileCacheEntry] = {}
FILE_CACHE_LOCK = threading.Lock()


def get_secondary_structure(u: mda.Universe) -> list[psique.SecondaryStructure]:
    """Return the secondary structure of the universe."""
    with tempfile.NamedTemporaryFile("w", suffix=".pdb") as file:
        u.atoms.write(file.name)
        return psique.assign(file.name)


def load_structure(path: Path | str, topology: str | None = None) -> mda.Universe:
    """Return an MDAnalysis Universe for path, reusing a cache while mtime/size match."""
    path = Path(path).resolve()
    stat = path.stat()
    mtime = stat.st_mtime
    file_size = stat.st_size
    with FILE_CACHE_LOCK:
        key = str(path)
        entry = FILE_CACHE.get(key)
        if entry is not None and entry.mtime == mtime and entry.size == file_size:
            return entry.universe
        u = mda.Universe(topology or path, path)
        FILE_CACHE[key] = FileCacheEntry(mtime, file_size, u)
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


class LoadPdbRequest(BaseModel):
    path: str = Field(..., description="Absolute path to a PDB/mmCIF file")


class SelectRequest(BaseModel):
    path: str = Field(..., description="Absolute path to a PDB/mmCIF file")
    topology: str | None = Field(description="Topology file name", default=None)
    selection: str = Field(..., description="MDAnalysis selection string")


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


@app.post("/load-pdb")
def load_pdb(payload: LoadPdbRequest) -> dict:
    path = os.path.abspath(os.path.expanduser(payload.path))
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    try:
        u = load_structure(path)
    except Exception as ex:
        raise HTTPException(
            status_code=400, detail=f"Could not read structure: {ex}"
        ) from ex

    n_atoms = int(u.atoms.n_atoms)
    if n_atoms == 0:
        raise HTTPException(status_code=400, detail="Structure contains no atoms")

    u.atoms.guess_bonds()  # TODO: improve performance

    atoms = [
        dict(
            x=float(it.position[0]),
            y=float(it.position[1]),
            z=float(it.position[2]),
            element=str(it.element),
            name=str(it.name).strip(),
        )
        for it in u.atoms
    ]
    bonds = u.bonds.indices.tolist()

    try:
        sec_segments = get_secondary_structure(u)
    except Exception:
        sec_segments = []

    residue_sec_table: dict[tuple[str, int, str | None], str] = {}
    for sec in sec_segments:
        for resid in range(sec.start.number, sec.end.number + 1):
            # FIXME: Handle insertion codes
            residue_sec_table[(sec.start.chain, resid, None)] = sec.kind.value

    residues: list[dict] = []
    for res in u.residues:
        chain = str(res.segid).strip()
        ca_atoms = res.atoms.select_atoms("name CA")
        residues.append(
            dict(
                chain=chain,
                resname=str(res.resname).strip(),
                number=int(res.resid),
                atom_indices=sorted(int(i) for i in res.atoms.indices.tolist()),
                sec=residue_sec_table.get((chain, res.resid, None)),
                ca_index=int(ca_atoms.indices[0]) if ca_atoms.n_atoms == 1 else None,
            )
        )

    return {"atoms": atoms, "bonds": bonds, "residues": residues}


@app.post("/select")
def select(payload: SelectRequest) -> dict:
    path = os.path.abspath(os.path.expanduser(payload.path))
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    try:
        u = load_structure(path, payload.topology)
        atoms = u.select_atoms(payload.selection)
    except Exception as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex

    atoms = [
        dict(x=float(pos[0]), y=float(pos[1]), z=float(pos[2]), element=elem)
        for pos, elem in zip(atoms.positions, atoms.elements)
    ]
    return {"atoms": atoms}


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
        shutil.copy2(pdb_files[0], output_dir / "system.pdb")

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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
