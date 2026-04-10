"""HTTP API for the GateWizard desktop app (spawned by Electron main process)."""

from multiprocessing import Value
import os
from importlib import metadata
from typing import List

import numpy as np
import MDAnalysis as mda
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from gatewizard.core.preparation import PreparationManager

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


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


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
        return dict(residues=residues)
    except Exception as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
