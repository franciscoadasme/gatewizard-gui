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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
