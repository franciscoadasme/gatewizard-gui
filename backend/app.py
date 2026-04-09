"""HTTP API for the GateWizard desktop app (spawned by Electron main process)."""

from importlib import metadata
from fastapi import FastAPI

app = FastAPI(title="GateWizard Backend")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/ping")
def ping() -> dict:
    try:
        version = metadata.version("gatewizard")
    except metadata.PackageNotFoundError:
        version = None
    return {"message": "pong", "gatewizard_version": version}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
