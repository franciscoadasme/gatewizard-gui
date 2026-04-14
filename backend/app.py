"""HTTP API for the GateWizard desktop app (spawned by Electron main process)."""

import base64
import os
import re
import tempfile
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
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from gatewizard.core.preparation import PreparationManager
from gatewizard.core.builder import Builder
from gatewizard.tools.force_fields import ForceFieldManager
from gatewizard.tools.ligand_parametrization import (
    detect_ligands,
    parametrize_ligand,
    get_ligand_2d_image,
    get_ligand_2d_image_from_pdb_lines,
)

app = FastAPI(title="GateWizard Backend")

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
    selection: str = Field(..., description="MDAnalysis selection string")


class RunPropKaRequest(BaseModel):
    path: str = Field(..., description="Absolute path to a PDB/mmCIF file")
    targetPh: float = Field(..., description="Target pH")


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
        u = mda.Universe(path)
    except Exception as ex:
        raise HTTPException(
            status_code=400, detail=f"Could not read structure: {ex}"
        ) from ex

    n_atoms = int(u.atoms.n_atoms)
    if n_atoms == 0:
        raise HTTPException(status_code=400, detail="Structure contains no atoms")

    coords = np.asarray(u.atoms.positions, dtype=np.float64)
    # TODO: remove centering (leave it to the camera rig)
    try:
        com = u.atoms.center_of_mass()
    except Exception:
        com = np.mean(coords, axis=0)
    coords = coords - com

    positions: List[float] = coords.reshape(-1).tolist()
    elements: List[str] = u.atoms.elements.tolist()

    return {
        "n_atoms": n_atoms,
        "path": path,
        "positions": positions,
        "elements": elements,
    }


@app.post("/select")
def select(payload: SelectRequest) -> dict:
    path = os.path.abspath(os.path.expanduser(payload.path))
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    try:
        u = mda.Universe(path)
        atoms = u.select_atoms(payload.selection)
    except Exception as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex

    coords = np.asarray(atoms.positions, dtype=np.float64)
    # TODO: remove centering (leave it to the camera rig)
    try:
        com = atoms.center_of_mass()
    except Exception:
        com = np.mean(coords, axis=0)
    coords = coords - com

    positions: List[float] = coords.reshape(-1).tolist()
    elements: List[str] = atoms.elements.tolist()

    return {
        "n_atoms": len(atoms),
        "path": path,
        "positions": positions,
        "elements": elements,
    }


@app.post("/run-propka")
def run_propka(payload: RunPropKaRequest) -> dict:
    path = os.path.abspath(os.path.expanduser(payload.path))
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    try:
        manager = PreparationManager(propka_version="3")
        pka_file = manager.run_analysis(path)
        summary_file = manager.extract_summary(pka_file)
        residues = manager.parse_summary(summary_file)
        for data in residues:
            state = manager.get_default_protonation_state(data, payload.targetPh)
            data["current_state"] = data["initial_state"] = state
            data["all_states"] = list(
                manager.get_available_states(data["residue"]).values()
            )
        residues = [it for it in residues if len(it["all_states"]) > 1]
        return dict(residues=residues)
    except Exception as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex


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
        result = parametrize_ligand(
            ligand_pdb=path,
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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
