"""FastAPI routes for remote cluster connect / probe / submit / sync."""

from __future__ import annotations

import json
import os
import queue
import re
import shlex
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from gatewizard.utils.cluster import (
    BatchScriptRequest,
    ClusterProfile,
    ClusterSSHError,
    canonicalize_slurm_state,
    close_session,
    connect_ssh,
    default_template_for_strategy,
    get_scheduler,
    join_remote,
    prefer_gpu_modules,
    prefer_partitions,
    probe_cluster,
    apply_probe_defaults,
    remote_file_count,
    render_batch_script,
    enrich_execution_resources,
    query_node_gres,
    resolve_compute_node,
    rsync_from_remote,
    rsync_to_remote,
    run_remote,
    ssh_channel,
    format_byte_size,
    local_dir_byte_size,
    remote_dir_byte_size,
    summarize_node_gpu_label,
    sync_scratch_progress_to_submit,
    update_execution_fields,
    verify_remote_files,
    write_execution_metadata,
)
from gatewizard.utils.cluster.midrun import (
    PROGRESS_RSYNC_FILTERS,
    remote_path_is_dir,
    resolve_remote_job_dir,
    resolve_scratch_job_dir,
    resolve_slurm_workdir,
    stage_scratch_to_login,
)
from gatewizard.utils.cluster.probe import read_job_metadata
from gatewizard.utils.cluster.resources import prefer_nodes

router = APIRouter(prefix="/cluster", tags=["cluster"])

_pull_cancel_lock = threading.Lock()
_pull_cancel_events: Dict[str, threading.Event] = {}


class PullCancelledError(Exception):
    """User cancelled an in-flight cluster pull."""


def _pull_local_key(local_dir: Path) -> str:
    return str(local_dir.resolve())


def _register_pull_cancel(local_dir: Path) -> threading.Event:
    key = _pull_local_key(local_dir)
    evt = threading.Event()
    with _pull_cancel_lock:
        old = _pull_cancel_events.get(key)
        if old is not None:
            old.set()
        _pull_cancel_events[key] = evt
    return evt


def _unregister_pull_cancel(local_dir: Path) -> None:
    key = _pull_local_key(local_dir)
    with _pull_cancel_lock:
        _pull_cancel_events.pop(key, None)


def _request_pull_cancel(local_dir: Path) -> bool:
    key = _pull_local_key(local_dir)
    with _pull_cancel_lock:
        evt = _pull_cancel_events.get(key)
    if evt is None:
        return False
    evt.set()
    return True


class ClusterProfilePayload(BaseModel):
    id: str = ""
    name: str = "Cluster"
    host: str
    username: str
    port: int = 22
    identity_file: str = ""
    scheduler: str = "slurm"
    submit_root: str = "/data/$USER/gatewizard"
    scratch_root: str = "$SCRATCH_DIR"
    workdir_strategy: str = "scratch_job_id"
    purge_modules: bool = True
    mail_user: str = ""
    mail_type: str = "NONE"
    default_time_limit: str = "24:00:00"
    extra_sbatch_lines: List[str] = Field(default_factory=list)
    batch_template: Optional[str] = None
    module_hints: Dict[str, List[str]] = Field(default_factory=dict)
    last_probe: Optional[Dict[str, Any]] = None


class ClusterConnectRequest(BaseModel):
    profile: ClusterProfilePayload
    password: Optional[str] = None


class ClusterSessionRequest(BaseModel):
    session_id: str


class ClusterProbeRequest(BaseModel):
    session_id: str
    profile: ClusterProfilePayload
    want_gpu: bool = True
    engine: str = ""


class ClusterRenderScriptRequest(BaseModel):
    profile: ClusterProfilePayload
    job_name: str
    job_folder_name: str = ""
    cpus: int = 8
    gpus: int = 0
    gpu_type: str = ""
    mem: str = ""
    time_limit: str = "24:00:00"
    partition: str = ""
    nodelist: str = ""
    constraint: str = ""
    modules: List[str] = Field(default_factory=list)
    run_command: str = "bash run_equilibration_cluster.sh"
    template_override: Optional[str] = None


class ClusterUploadRequest(BaseModel):
    session_id: str
    local_dir: str
    remote_dir: str
    delete: bool = False


class ClusterSubmitRequest(BaseModel):
    session_id: str
    profile: ClusterProfilePayload
    local_dir: str
    remote_dir: str
    job_name: str
    job_folder_name: str = ""
    cpus: int = 8
    gpus: int = 0
    gpu_type: str = ""
    mem: str = ""
    time_limit: str = "24:00:00"
    partition: str = ""
    nodelist: str = ""
    constraint: str = ""
    modules: List[str] = Field(default_factory=list)
    script_text: Optional[str] = None
    run_command: str = "bash run_equilibration_cluster.sh"
    upload_first: bool = True
    force: bool = False


class ClusterJobStatusRequest(BaseModel):
    session_id: Optional[str] = None
    profile: Optional[ClusterProfilePayload] = None
    password: Optional[str] = None
    job_id: Optional[str] = None
    local_dir: Optional[str] = None
    pull_logs: bool = False
    remote_dir: Optional[str] = None


class ClusterCancelRequest(BaseModel):
    session_id: str
    job_id: str
    local_dir: Optional[str] = None


class ClusterPullRequest(BaseModel):
    session_id: str
    local_dir: str
    remote_dir: str
    full: bool = True
    profile: Optional[ClusterProfilePayload] = None
    job_id: Optional[str] = None


class ClusterCancelPullRequest(BaseModel):
    local_dir: str = Field(description="Local equilibration job folder being pulled")


class ClusterLocalDirSizeRequest(BaseModel):
    local_dir: str
    excludes: Optional[List[str]] = None


class ClusterJobFolderSizesRequest(BaseModel):
    local_dir: str
    session_id: Optional[str] = None
    remote_dir: Optional[str] = None
    measure_remote: bool = True
    excludes: Optional[List[str]] = None


def _profile(payload: ClusterProfilePayload) -> ClusterProfile:
    return ClusterProfile.from_dict(payload.model_dump())


def _resolve_remote_dir_for_job(
    session_id: str,
    *,
    local_dir: Path,
    stored_path: str,
    job_id: str,
    profile: Optional[ClusterProfilePayload] = None,
) -> tuple[str, str, list[str]]:
    """Find the remote job folder, correcting stale ``remote_path`` metadata."""
    submit_root = ""
    username = ""
    if profile:
        cp = _profile(profile)
        submit_root = cp.submit_root or ""
        username = cp.username or ""
    resolved, source, tried = resolve_remote_job_dir(
        session_id,
        stored_path=stored_path,
        job_id=job_id,
        submit_root=submit_root,
        username=username,
        job_folder=local_dir.name,
    )
    if (
        resolved
        and not source.startswith("unverified")
        and resolved.rstrip("/") != (stored_path or "").rstrip("/")
    ):
        update_execution_fields(local_dir, remote_path=resolved)
    return resolved, source, tried


def _midrun_sync_progress(
    session_id: str,
    *,
    local_dir: Path,
    remote_dir: str,
    job_id: Optional[str],
    node_hint: str = "",
    profile: Optional[ClusterProfilePayload] = None,
    remote_state: Optional[str] = None,
) -> Optional[str]:
    """Copy live stage logs from node-local scratch → submit dir (if applicable)."""
    state_u = str(remote_state or "").upper()
    if state_u and state_u not in {"RUNNING", "COMPLETING"}:
        return None
    if not job_id or not remote_dir:
        return None
    try:
        meta = read_job_metadata(local_dir)
        execution = (
            meta.get("execution") if isinstance(meta.get("execution"), dict) else {}
        )
        if not state_u:
            state_u = str(execution.get("last_remote_state") or "").upper()
            if state_u and state_u not in {"RUNNING", "COMPLETING"}:
                return None
        scratch_root = ""
        if profile:
            scratch_root = (_profile(profile).scratch_root or "").strip()
        if not scratch_root:
            scratch_root = str(execution.get("scratch_root") or "").strip()
        strategy = str(execution.get("workdir_strategy") or "scratch_job_id")
        if strategy not in {"scratch_job_id", "scratch_named"}:
            return None
        if not scratch_root or scratch_root.startswith("$"):
            return "mid-run sync skipped: scratch_root unset or unresolved"
        node = (node_hint or "").split(",")[0].strip()
        if not node:
            node = resolve_compute_node(session_id, str(job_id))
        if not node:
            return "mid-run sync skipped: no compute node"
        scratch_key = str(job_id)
        if strategy == "scratch_named":
            scratch_key = (
                Path(remote_dir).name
                or str(execution.get("job_folder_name") or job_id)
            )
        ok_m, msg_m = sync_scratch_progress_to_submit(
            session_id,
            job_id=scratch_key,
            node=node,
            scratch_root=scratch_root,
            remote_submit_dir=remote_dir,
        )
        if ok_m:
            update_execution_fields(
                local_dir,
                node_list=node,
                last_midrun_sync_at=datetime.now(timezone.utc).isoformat(),
            )
        return msg_m
    except Exception as ex:
        return f"mid-run sync skipped: {ex}"


def _resolve_session_id(
    session_id: Optional[str],
    profile: Optional[ClusterProfilePayload],
    password: Optional[str] = None,
) -> str:
    """Reuse an open session, or connect with the profile (SSH key preferred)."""
    if session_id:
        return session_id
    if not profile:
        raise HTTPException(
            status_code=400,
            detail="session_id or profile required (Connect & probe, or set an SSH key in Settings)",
        )
    cp = _profile(profile)
    if not (cp.identity_file or "").strip() and not password:
        raise HTTPException(
            status_code=400,
            detail=(
                "No active SSH session. Open Cluster… and Connect & probe once, "
                "or set identity_file on the profile for Watching auto-refresh."
            ),
        )
    try:
        session = connect_ssh(
            host=cp.host,
            username=cp.username,
            port=cp.port,
            identity_file=cp.identity_file,
            password=password,
        )
    except ClusterSSHError as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex
    return session.session_id


@router.post("/connect")
def cluster_connect(payload: ClusterConnectRequest) -> dict:
    profile = _profile(payload.profile)
    try:
        session = connect_ssh(
            host=profile.host,
            username=profile.username,
            port=profile.port,
            identity_file=profile.identity_file,
            password=payload.password,
        )
    except ClusterSSHError as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex
    finally:
        # Ensure password is not retained on the request object longer than needed
        payload.password = None
    return {
        "session_id": session.session_id,
        "host": session.host,
        "username": session.username,
        "auth": "password" if session.use_paramiko else "key",
    }


@router.post("/disconnect")
def cluster_disconnect(payload: ClusterSessionRequest) -> dict:
    close_session(payload.session_id)
    return {"ok": True}


@router.post("/probe")
def cluster_probe(payload: ClusterProbeRequest) -> dict:
    profile = _profile(payload.profile)
    try:
        probe = probe_cluster(payload.session_id, profile=profile)
        updated = apply_probe_defaults(profile, probe)
    except ClusterSSHError as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex

    want_gpu = bool(payload.want_gpu)
    suggested = {
        engine: [m.to_dict() for m in prefer_gpu_modules(mods, want_gpu=want_gpu)[:8]]
        for engine, mods in probe.engine_modules.items()
        if mods
    }
    ranked_partitions = prefer_partitions(probe.partitions, want_gpu=want_gpu)
    ranked_nodes = prefer_nodes(probe.nodes, want_gpu=want_gpu)
    return {
        "probe": probe.to_dict(),
        "profile": updated.to_dict(),
        "suggested_modules": suggested,
        "suggested_partitions": [p.to_dict() for p in ranked_partitions],
        "suggested_nodes": [n.to_dict() for n in ranked_nodes],
        "want_gpu": want_gpu,
        "engine": payload.engine or "",
        "errors": list(probe.errors or []),
    }


@router.post("/default-template")
def cluster_default_template(payload: ClusterProfilePayload) -> dict:
    strategy = payload.workdir_strategy or "scratch_job_id"
    return {
        "workdir_strategy": strategy,
        "template": payload.batch_template
        or default_template_for_strategy(strategy),
    }


@router.post("/render-script")
def cluster_render_script(payload: ClusterRenderScriptRequest) -> dict:
    profile = _profile(payload.profile)
    req = BatchScriptRequest(
        job_name=payload.job_name,
        cpus=payload.cpus,
        gpus=payload.gpus,
        gpu_type=payload.gpu_type or "",
        mem=payload.mem,
        time_limit=payload.time_limit,
        partition=payload.partition,
        nodelist=payload.nodelist,
        constraint=payload.constraint,
        modules=payload.modules,
        purge_modules=profile.purge_modules,
        mail_user=profile.mail_user,
        mail_type=profile.mail_type,
        extra_sbatch_lines=list(profile.extra_sbatch_lines),
        workdir_strategy=profile.workdir_strategy,
        scratch_root=profile.scratch_root,
        job_folder_name=payload.job_folder_name or payload.job_name,
        run_command=payload.run_command,
        template=payload.template_override
        if payload.template_override is not None
        else profile.batch_template,
    )
    script = render_batch_script(req)
    return {"script": script, "filename": "run_equilibration.slurm"}


@router.post("/upload-job")
def cluster_upload_job(payload: ClusterUploadRequest) -> dict:
    local = Path(payload.local_dir)
    if not local.is_dir():
        raise HTTPException(status_code=404, detail=f"Local job dir not found: {local}")
    try:
        rc, out, err = rsync_to_remote(
            payload.session_id,
            str(local),
            payload.remote_dir,
            delete=payload.delete,
            excludes=["equilibration.pid", "__pycache__", "*.pyc"],
        )
    except ClusterSSHError as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex
    if rc != 0:
        raise HTTPException(status_code=400, detail=err or out or f"rsync failed ({rc})")
    return {"ok": True, "remote_dir": payload.remote_dir, "stdout": out}


_SUBMIT_IN_FLIGHT: Dict[str, float] = {}
_SUBMIT_IN_FLIGHT_LOCK = threading.Lock()


def _submit_dir_key(local: Path) -> str:
    try:
        return str(local.resolve())
    except OSError:
        return str(local)


def _acquire_submit_lock(local: Path, *, force: bool = False) -> None:
    """Prevent two sbatch uploads for the same folder (double-click / overlapping polls)."""
    key = _submit_dir_key(local)
    now = time.time()
    with _SUBMIT_IN_FLIGHT_LOCK:
        stale = [k for k, started in _SUBMIT_IN_FLIGHT.items() if now - started > 600]
        for k in stale:
            _SUBMIT_IN_FLIGHT.pop(k, None)
        started = _SUBMIT_IN_FLIGHT.get(key)
        if started is not None and not force:
            raise HTTPException(
                status_code=409,
                detail=(
                    "A submit is already in progress for this job folder. "
                    "Wait for upload/sbatch to finish — do not click Submit again."
                ),
            )
        _SUBMIT_IN_FLIGHT[key] = now


def _release_submit_lock(local: Path) -> None:
    with _SUBMIT_IN_FLIGHT_LOCK:
        _SUBMIT_IN_FLIGHT.pop(_submit_dir_key(local), None)


def _recent_active_scheduler_job(local: Path, *, window_s: int = 90) -> Optional[str]:
    """Return a Slurm id if this folder was just submitted and still looks live."""
    try:
        execution = read_job_metadata(local).get("execution") or {}
    except Exception:
        return None
    if not isinstance(execution, dict):
        return None
    jid = str(execution.get("scheduler_job_id") or "").strip()
    if not jid:
        return None
    state = canonicalize_slurm_state(execution.get("last_remote_state") or "")
    submitted = str(execution.get("submitted_at") or "").strip()
    age = 10_000.0
    if submitted:
        try:
            ts = datetime.fromisoformat(submitted.replace("Z", "+00:00"))
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            age = (datetime.now(timezone.utc) - ts).total_seconds()
        except ValueError:
            age = 10_000.0
    if state in {"PENDING", "CONFIGURING", "RUNNING", "COMPLETING", "REQUEUED"}:
        if age < max(window_s, 3600):
            return jid
    return None


def _emit_submit_progress(
    on_progress: Optional[Callable[[Dict[str, Any]], None]],
    *,
    phase: str,
    percent: Optional[int],
    message: str,
    **extra: Any,
) -> None:
    if on_progress is None:
        return
    evt: Dict[str, Any] = {"phase": phase, "percent": percent, "message": message}
    evt.update(extra)
    on_progress(evt)


def _execute_cluster_submit(
    payload: ClusterSubmitRequest,
    *,
    on_progress: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> dict:
    profile = _profile(payload.profile)
    local = Path(payload.local_dir)
    if not local.is_dir():
        raise HTTPException(status_code=404, detail=f"Local job dir not found: {local}")
    if not (local / "run_equilibration.sh").is_file():
        raise HTTPException(
            status_code=400,
            detail="run_equilibration.sh missing — generate the equilibration job locally first",
        )
    if not payload.force:
        recent_jid = _recent_active_scheduler_job(local)
        if recent_jid:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Slurm job {recent_jid} was just submitted for this folder and still "
                    "looks active. Cancel it first, or wait — a second Submit would queue "
                    "a duplicate."
                ),
            )
    _acquire_submit_lock(local, force=payload.force)
    try:
        return _execute_cluster_submit_locked(payload, profile, local, on_progress=on_progress)
    finally:
        _release_submit_lock(local)


def _execute_cluster_submit_locked(
    payload: ClusterSubmitRequest,
    profile: ClusterProfile,
    local: Path,
    *,
    on_progress: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> dict:
    _emit_submit_progress(
        on_progress, phase="prepare", percent=5, message="Preparing batch script…"
    )

    from gatewizard.utils.equilibration_cluster_script import (
        CLUSTER_RUN_SCRIPT,
        ensure_amber_cluster_runner_for_gpus,
        resolve_cluster_launch_script,
        script_has_wsl_or_windows_path,
    )

    # Amber: cluster submenu GPUs must drive pmemd.cuda (not local picker "pmemd").
    try:
        ensure_amber_cluster_runner_for_gpus(local, gpus=int(payload.gpus or 0))
    except Exception:
        pass

    launch_script = resolve_cluster_launch_script(local)
    launch_name = launch_script.name
    if launch_name == CLUSTER_RUN_SCRIPT:
        run_command = payload.run_command or f"bash {CLUSTER_RUN_SCRIPT}"
        if "run_equilibration.sh" in run_command and CLUSTER_RUN_SCRIPT not in run_command:
            run_command = f"bash {CLUSTER_RUN_SCRIPT}"
    else:
        # Older job folders without a cluster runner
        run_command = payload.run_command or "bash run_equilibration.sh"
        if CLUSTER_RUN_SCRIPT in run_command:
            run_command = "bash run_equilibration.sh"

    from gatewizard.utils.equilibration_job_metadata import infer_equilibration_job_metadata
    from gatewizard.utils.equilibration_resume import prepare_cluster_resubmit

    job_meta = infer_equilibration_job_metadata(local, heal=False)
    engine = (job_meta.get("engine") if isinstance(job_meta, dict) else None) or "namd"
    run_command, resume_point = prepare_cluster_resubmit(local, engine, run_command)

    launch_text = launch_script.read_text(encoding="utf-8", errors="replace")
    if script_has_wsl_or_windows_path(launch_text):
        raise HTTPException(
            status_code=400,
            detail=(
                f"{launch_name} still uses a local Windows/WSL executable path "
                "(e.g. /mnt/c/...). That path does not exist on the cluster. "
                "Regenerate inputs (creates run_equilibration_cluster.sh with namd3/gmx/…) "
                "or edit the cluster runner so the engine command is module-friendly."
            ),
        )

    script = payload.script_text
    if not script:
        script = render_batch_script(
            BatchScriptRequest(
                job_name=payload.job_name,
                cpus=payload.cpus,
                gpus=payload.gpus,
                gpu_type=payload.gpu_type or "",
                mem=payload.mem,
                time_limit=payload.time_limit,
                partition=payload.partition,
                nodelist=payload.nodelist,
                constraint=payload.constraint,
                modules=payload.modules,
                purge_modules=profile.purge_modules,
                mail_user=profile.mail_user,
                mail_type=profile.mail_type,
                extra_sbatch_lines=list(profile.extra_sbatch_lines),
                workdir_strategy=profile.workdir_strategy,
                scratch_root=profile.scratch_root,
                job_folder_name=payload.job_folder_name or local.name,
                run_command=run_command,
                template=profile.batch_template,
            )
        )
    elif launch_name == CLUSTER_RUN_SCRIPT and "run_equilibration_cluster.sh" not in script:
        # Edited .slurm still calling the local runner — nudge to cluster script
        script = script.replace(
            "bash run_equilibration.sh", f"bash {CLUSTER_RUN_SCRIPT}"
        )

    # Keep RESUME=1 in edited/previewed .slurm when continuing a prior run.
    # Must sit *before* stdbuf — stdbuf treats the next token as the program.
    if script and "RESUME=1" in run_command and "RESUME=" not in script:
        script = script.replace(
            "stdbuf -oL -eL bash run_equilibration_cluster.sh",
            "RESUME=1 stdbuf -oL -eL bash run_equilibration_cluster.sh",
        )
        script = script.replace(
            "stdbuf -oL -eL bash run_equilibration.sh",
            "RESUME=1 stdbuf -oL -eL bash run_equilibration.sh",
        )
        if "RESUME=" not in script:
            script = script.replace(
                f"bash {CLUSTER_RUN_SCRIPT}",
                f"RESUME=1 bash {CLUSTER_RUN_SCRIPT}",
            )
            script = script.replace(
                "bash run_equilibration.sh",
                "RESUME=1 bash run_equilibration.sh",
            )

    script_path = local / "run_equilibration.slurm"
    script_path.write_text(script, encoding="utf-8")

    # Resubmit into a folder that still has the previous FATAL logs would keep
    # showing "error" while the new Slurm job is RUNNING — archive those first.
    from datetime import datetime, timezone

    from gatewizard.utils.equilibration_failure import archive_previous_run_outputs

    _emit_submit_progress(
        on_progress, phase="archive", percent=12, message="Archiving previous run outputs…"
    )
    archived = archive_previous_run_outputs(local, engine=engine)

    upload_excludes = [
        "equilibration.pid",
        "__pycache__",
        "*.pyc",
        "_previous_cluster_run",
    ]
    local_file_count = sum(1 for p in local.rglob("*") if p.is_file())
    local_bytes = local_dir_byte_size(local, excludes=upload_excludes)
    try:
        if payload.upload_first:
            def _map_upload_progress(evt: Dict[str, Any]) -> None:
                raw = evt.get("percent")
                mapped = 18
                if isinstance(raw, (int, float)):
                    mapped = 18 + int(max(0, min(100, float(raw))) * 0.62)
                payload_evt = dict(evt)
                payload_evt["phase"] = "upload"
                payload_evt["percent"] = mapped
                if not payload_evt.get("message"):
                    payload_evt["message"] = "Uploading job folder…"
                _emit_submit_progress(on_progress, **payload_evt)

            _emit_submit_progress(
                on_progress,
                phase="upload",
                percent=18,
                message=(
                    f"Uploading job folder ({format_byte_size(local_bytes)})…"
                    if local_bytes > 0
                    else "Uploading job folder…"
                ),
                bytes=0,
                total_bytes=local_bytes or None,
            )
            rc, out, err = rsync_to_remote(
                payload.session_id,
                str(local),
                payload.remote_dir,
                excludes=upload_excludes,
                on_progress=_map_upload_progress if on_progress else None,
                expected_bytes=local_bytes or None,
            )
            if rc != 0:
                raise HTTPException(
                    status_code=400, detail=err or out or "upload failed"
                )

        _emit_submit_progress(
            on_progress, phase="verify", percent=84, message="Verifying remote files…"
        )
        required = [launch_name, "run_equilibration.slurm"]
        ok, verify_msg = verify_remote_files(
            payload.session_id,
            payload.remote_dir,
            required,
        )
        if not ok:
            remote_n = remote_file_count(payload.session_id, payload.remote_dir)
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Upload incomplete (local files={local_file_count}, "
                    f"remote files≈{remote_n}). {verify_msg}"
                ),
            )

        _emit_submit_progress(
            on_progress, phase="sbatch", percent=92, message="Submitting with sbatch…"
        )
        cmd = (
            f"cd {shlex.quote(payload.remote_dir)} && "
            f"sbatch {shlex.quote('run_equilibration.slurm')}"
        )
        rc, out, err = run_remote(payload.session_id, cmd, timeout=60)
    except ClusterSSHError as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex

    if rc != 0:
        raise HTTPException(status_code=400, detail=err or out or "sbatch failed")

    adapter = get_scheduler(profile.scheduler)
    job_id = adapter.parse_submit_output(out) or adapter.parse_submit_output(err)
    if not job_id:
        raise HTTPException(
            status_code=400, detail=f"Could not parse sbatch job id from: {out or err}"
        )

    execution = {
        "mode": "remote",
        "cluster_id": profile.id,
        "cluster_name": profile.name,
        "scheduler": profile.scheduler,
        "remote_path": payload.remote_dir,
        "scheduler_job_id": job_id,
        "partition": payload.partition,
        "nodelist": payload.nodelist or None,
        "time_limit": payload.time_limit,
        "modules": list(payload.modules),
        "resources": {
            "cpus": payload.cpus,
            "gpus": payload.gpus,
            "gpu_type": (payload.gpu_type or "").strip() or None,
            "mem": payload.mem,
        },
        "workdir_strategy": profile.workdir_strategy,
        "scratch_root": profile.scratch_root,
        "batch_script": "run_equilibration.slurm",
        "last_remote_state": "PENDING",
        "submitted_at": datetime.now(timezone.utc).isoformat(),
        # Clear prior attempt diagnostics so the card does not keep red errors.
        "last_error": None,
        "last_error_source": None,
        "last_error_note": None,
        "archived_previous_outputs": archived,
        "cluster_resume": resume_point.can_resume,
    }
    write_execution_metadata(local, execution)
    try:
        _push_equilibration_job_json(payload.session_id, local, payload.remote_dir)
    except Exception:
        pass
    return {
        "ok": True,
        "job_id": job_id,
        "remote_dir": payload.remote_dir,
        "script": script,
        "stdout": out,
        "execution": execution,
        "uploaded_files_local": local_file_count,
        "archived_previous_outputs": archived,
        "cluster_resume": {
            "enabled": resume_point.can_resume,
            "stage_name": resume_point.stage_name if resume_point.can_resume else None,
            "completed_stages": resume_point.completed_stages,
            "total_stages": resume_point.total_stages,
        },
    }


@router.post("/submit-job")
def cluster_submit_job(payload: ClusterSubmitRequest) -> dict:
    return _execute_cluster_submit(payload)


@router.post("/submit-job-stream")
async def cluster_submit_job_stream(payload: ClusterSubmitRequest) -> StreamingResponse:
    """NDJSON stream of upload/sbatch progress, ending with ``phase=done|error``."""
    import asyncio

    async def event_stream():
        progress_q: queue.Queue = queue.Queue()

        def on_progress(evt: Dict[str, Any]) -> None:
            progress_q.put(("progress", evt))

        def worker() -> None:
            try:
                on_progress(
                    {
                        "phase": "prepare",
                        "percent": 2,
                        "message": "Starting upload & submit…",
                    }
                )
                result = _execute_cluster_submit(payload, on_progress=on_progress)
                progress_q.put(("done", result))
            except HTTPException as ex:
                detail = ex.detail
                msg = detail if isinstance(detail, str) else str(detail)
                progress_q.put(
                    ("error", {"message": msg, "status_code": ex.status_code})
                )
            except ClusterSSHError as ex:
                progress_q.put(("error", {"message": str(ex)}))
            except Exception as ex:
                progress_q.put(("error", {"message": str(ex)}))
            finally:
                progress_q.put(None)

        threading.Thread(target=worker, daemon=True).start()
        loop = asyncio.get_running_loop()
        while True:
            item = await loop.run_in_executor(None, progress_q.get)
            if item is None:
                break
            kind, payload_evt = item
            if kind == "progress":
                yield json.dumps(payload_evt, ensure_ascii=False) + "\n"
            elif kind == "done":
                job_id = ""
                if isinstance(payload_evt, dict):
                    job_id = str(payload_evt.get("job_id") or "")
                yield json.dumps(
                    {
                        "phase": "done",
                        "percent": 100,
                        "message": (
                            f"Submitted Slurm job {job_id}" if job_id else "Submit complete"
                        ),
                        "result": payload_evt,
                    },
                    ensure_ascii=False,
                ) + "\n"
            elif kind == "error":
                yield json.dumps(
                    {
                        "phase": "error",
                        "percent": None,
                        "message": payload_evt.get("message") or "Submit failed",
                        "error": payload_evt.get("message") or "Submit failed",
                    },
                    ensure_ascii=False,
                ) + "\n"
            await asyncio.sleep(0)

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Content-Encoding": "identity",
        },
    )


def _pull_progress_logs(
    session_id: str,
    remote_dir: str,
    local_dir: Path,
    *,
    profile: Optional[ClusterProfilePayload] = None,
    job_id: Optional[str] = None,
    append: bool = True,
) -> dict:
    """Lightweight Watching sync: stage logs only (not trajectories / full Pull)."""
    local = Path(local_dir)
    local.mkdir(parents=True, exist_ok=True)
    remote_dir = (remote_dir or "").strip().rstrip("/")
    if not remote_dir:
        raise HTTPException(status_code=400, detail="Remote job path is empty")

    jid = str(job_id or "").strip()
    prior = read_job_metadata(local)
    prior_execution = dict(prior.get("execution") or {})
    if not jid:
        jid = str(prior_execution.get("scheduler_job_id") or "").strip()

    resolved, source, tried = _resolve_remote_dir_for_job(
        session_id,
        local_dir=local,
        stored_path=remote_dir,
        job_id=jid,
        profile=profile,
    )
    pull_source = remote_dir
    note_parts: List[str] = []
    if resolved and not source.startswith("unverified"):
        pull_source = resolved
        if resolved.rstrip("/") != remote_dir.rstrip("/"):
            note_parts.append(f"path via {source}")
            update_execution_fields(local, remote_path=resolved)

    if not remote_path_is_dir(session_id, pull_source):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Remote directory not found for progress sync. Tried: {', '.join(tried)}"
                if tried
                else f"Remote directory not found: {remote_dir}"
            ),
        )

    try:
        rc, out, err = rsync_from_remote(
            session_id,
            pull_source,
            str(local),
            includes=list(PROGRESS_RSYNC_FILTERS),
            excludes=["equilibration.pid", "equilibration_job.json"],
            # Logs only + append/size-only: avoid re-downloading multi-GB mdout /
            # restart files on every 60s Watching poll (ignore-times was doing that).
            size_only=True,
            append=append,
            timeout=120,
        )
    except ClusterSSHError as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex

    # Don't fail the whole watch cycle if rsync code 23 (partial) on empty match.
    if rc not in {0, 23}:
        raise HTTPException(
            status_code=400, detail=(err or out or f"progress sync failed ({rc})").strip()
        )

    update_execution_fields(
        local,
        last_progress_sync_at=datetime.now(timezone.utc).isoformat(),
        remote_path=pull_source if pull_source else None,
    )
    return {
        "ok": True,
        "mode": "logs",
        "stdout": out,
        "stderr": err,
        "pull_source": pull_source,
        "pull_note": "; ".join(note_parts) if note_parts else None,
    }


def _prefer_newer_execution(
    current: Dict[str, Any], prior: Dict[str, Any]
) -> Dict[str, Any]:
    """When resubmit races with pull/watch, keep the newest execution block."""
    from gatewizard.utils.equilibration_failure import parse_submitted_at

    if not prior:
        return dict(current or {})
    if not current:
        return dict(prior)
    # Never drop a known Slurm id for a copy that never stored one (remote JSON
    # is uploaded before sbatch, so it usually has no scheduler_job_id).
    if prior.get("scheduler_job_id") and not current.get("scheduler_job_id"):
        return dict(prior)
    if current.get("scheduler_job_id") and not prior.get("scheduler_job_id"):
        return dict(current)
    tc = parse_submitted_at(current)
    tp = parse_submitted_at(prior)
    if tc and tp:
        return dict(current if tc >= tp else prior)
    return dict(current or prior)


def _resolve_stored_job_id(local: Path, request_jid: Optional[str] = None) -> str:
    meta = read_job_metadata(local)
    exec_meta = meta.get("execution") if isinstance(meta.get("execution"), dict) else {}
    req = str(request_jid or "").strip()
    if req:
        newer = _prefer_newer_execution(exec_meta, {**exec_meta, "scheduler_job_id": req})
        return str(newer.get("scheduler_job_id") or req or exec_meta.get("scheduler_job_id") or "")
    return str(exec_meta.get("scheduler_job_id") or "").strip()


def _query_slurm_job_state(session_id: str, job_id: str) -> str:
    if not (session_id and job_id):
        return ""
    adapter = get_scheduler("slurm")
    cmd = " ".join(shlex.quote(x) for x in adapter.status_command(job_id))
    _rc, out, _err = run_remote(session_id, cmd, timeout=60)
    handles = adapter.parse_status(out, job_id=job_id)
    if handles:
        return canonicalize_slurm_state(handles[0].state)
    acct_cmd = " ".join(shlex.quote(x) for x in adapter.accounting_command(job_id))
    _rc2, out2, _err2 = run_remote(session_id, acct_cmd, timeout=60)
    if out2.strip():
        first = out2.strip().splitlines()[0]
        cols = first.split("|")
        if len(cols) >= 2:
            return canonicalize_slurm_state(cols[1])
    return ""


def _push_equilibration_job_json(session_id: str, local: Path, remote_dir: str) -> None:
    """Copy local equilibration_job.json to the remote submit dir (has the Slurm id)."""
    import base64

    src = Path(local) / "equilibration_job.json"
    dest_dir = (remote_dir or "").strip().rstrip("/")
    if not session_id or not src.is_file() or not dest_dir:
        return
    dest = f"{dest_dir}/equilibration_job.json"
    b64 = base64.b64encode(src.read_bytes()).decode("ascii")
    cmd = (
        "python3 -c "
        + shlex.quote(
            "import base64,sys; open(sys.argv[1],'wb').write(base64.b64decode(sys.argv[2]))"
        )
        + f" {shlex.quote(dest)} {shlex.quote(b64)}"
    )
    run_remote(session_id, cmd, timeout=30)


def _recover_missing_job_identity(
    session_id: str,
    local: Path,
    *,
    profile: Optional[ClusterProfilePayload] = None,
    remote_dir: Optional[str] = None,
) -> Dict[str, Any]:
    """Rediscover Slurm id / remote path when local execution metadata was wiped."""
    from gatewizard.utils.cluster.midrun import build_remote_submit_path
    from gatewizard.utils.cluster.probe import (
        infer_remote_path_from_peer_jobs,
        local_scheduler_job_id_hints,
        parse_job_ids_from_filenames,
        parse_sbatch_job_name,
        parse_sacct_allocations,
        pick_latest_sacct_allocation,
    )

    local = Path(local)
    fields: Dict[str, Any] = {}
    job_name = parse_sbatch_job_name(local)
    hints = local_scheduler_job_id_hints(local, job_name=job_name)
    jid = hints[0] if hints else ""
    state = ""

    remote_path = (remote_dir or "").strip().rstrip("/")
    if not remote_path:
        meta = read_job_metadata(local)
        ex = meta.get("execution") if isinstance(meta.get("execution"), dict) else {}
        remote_path = str(ex.get("remote_path") or "").rstrip("/")
    if not remote_path:
        remote_path = infer_remote_path_from_peer_jobs(local) or ""
    if not remote_path and profile:
        cp = _profile(profile)
        remote_path = build_remote_submit_path(
            cp.submit_root or "",
            local.name,
            username=cp.username or "",
        )

    adapter = get_scheduler("slurm")

    if remote_path:
        globs = [f"{shlex.quote(remote_path)}/gw_*.log"]
        if job_name:
            globs.append(
                f"{shlex.quote(remote_path)}/{shlex.quote(job_name)}.*.out"
            )
            globs.append(
                f"{shlex.quote(remote_path)}/{shlex.quote(job_name)}.*.err"
            )
        ls_cmd = "ls -1t " + " ".join(globs) + " 2>/dev/null || true"
        try:
            _rc, out, _err = run_remote(session_id, ls_cmd, timeout=30)
            remote_ids = parse_job_ids_from_filenames(out.splitlines(), job_name)
            if remote_ids:
                jid = remote_ids[0]
        except Exception:
            pass

    if job_name:
        try:
            cmd = " ".join(
                shlex.quote(x) for x in adapter.name_accounting_command(job_name)
            )
            _rc, out, _err = run_remote(session_id, cmd, timeout=60)
            rows = parse_sacct_allocations(out)
            rows = [r for r in rows if not r.get("name") or r["name"] == job_name]
            picked = pick_latest_sacct_allocation(rows)
            if picked:
                jid = str(picked.get("job_id") or jid)
                state = canonicalize_slurm_state(picked.get("state") or "")
        except Exception:
            pass

        try:
            cmd = " ".join(
                shlex.quote(x) for x in adapter.name_status_command(job_name)
            )
            _rc, out, _err = run_remote(session_id, cmd, timeout=60)
            handles = adapter.parse_status(out)
            if handles:
                jid = str(handles[0].job_id or jid)
                state = canonicalize_slurm_state(handles[0].state)
                if handles[0].node_list:
                    fields["node_list"] = handles[0].node_list.split(",")[0].strip()
                if getattr(handles[0], "cpus", 0):
                    fields["allocated_cpus"] = int(handles[0].cpus)
                if handles[0].partition:
                    fields["partition"] = handles[0].partition
        except Exception:
            pass

    if jid:
        fields["scheduler_job_id"] = str(jid)
        fields["mode"] = "remote"
        fields["batch_script"] = "run_equilibration.slurm"
    if remote_path:
        fields["remote_path"] = remote_path
    if state:
        fields["last_remote_state"] = state
    if profile:
        cp = _profile(profile)
        if cp.id:
            fields["cluster_id"] = cp.id
        if cp.name:
            fields["cluster_name"] = cp.name
    if fields.get("scheduler_job_id"):
        update_execution_fields(local, **fields)
    return fields


def _fetch_remote_execution(session_id: str, remote_dir: str) -> Dict[str, Any]:
    remote_dir = (remote_dir or "").strip().rstrip("/")
    if not (session_id and remote_dir):
        return {}
    remote_job = f"{remote_dir}/equilibration_job.json"
    try:
        _rc, out_m, _err = run_remote(
            session_id,
            "python3 -c "
            + shlex.quote(
                "import json;print(json.dumps(json.load(open("
                + repr(remote_job)
                + "))))"
            )
            + " 2>/dev/null || true",
            timeout=30,
        )
        if out_m.strip():
            remote_meta = json.loads(out_m.strip().splitlines()[-1])
            if isinstance(remote_meta, dict):
                ex = remote_meta.get("execution")
                if isinstance(ex, dict):
                    return ex
    except Exception:
        pass
    return {}


def _pull_job_files(
    session_id: str,
    remote_dir: str,
    local_dir: Path,
    *,
    remote_state: Optional[str] = None,
    profile: Optional[ClusterProfilePayload] = None,
    job_id: Optional[str] = None,
    on_progress: Optional[Callable[[Dict[str, Any]], None]] = None,
    cancel_event: Optional[threading.Event] = None,
) -> dict:
    """Rsync remote → local without clobbering local execution metadata."""
    from gatewizard.utils.equilibration_failure import (
        PULL_PRESERVE_EXCLUDES,
        find_equilibration_failure,
        parse_submitted_at,
        summarize_slurm_outputs,
    )
    from gatewizard.utils.cluster.probe import read_job_metadata

    def emit(phase: str, message: str, percent: Optional[int] = None, **extra: Any) -> None:
        if cancel_event and cancel_event.is_set():
            raise PullCancelledError()
        if not on_progress:
            return
        evt: Dict[str, Any] = {"phase": phase, "message": message}
        if percent is not None:
            evt["percent"] = percent
        evt.update(extra)
        on_progress(evt)

    local = Path(local_dir)
    local.mkdir(parents=True, exist_ok=True)

    # Snapshot execution before pull — remote JSON often lacks job id / state.
    prior = read_job_metadata(local)
    prior_execution = dict(prior.get("execution") or {})

    remote_dir = (remote_dir or "").strip().rstrip("/")
    if not remote_dir:
        raise HTTPException(status_code=400, detail="Remote job path is empty")

    jid = str(job_id or prior_execution.get("scheduler_job_id") or "").strip()
    pull_source = remote_dir
    pull_note_parts: List[str] = []
    staging_dir = ""

    emit("resolve", "Resolving remote path…", 2)
    state_label = str(remote_state or "").strip().upper()
    partial_pull = state_label in {
        "PENDING",
        "RUNNING",
        "CONFIGURING",
        "COMPLETING",
        "REQUEUED",
        "SUSPENDED",
    }
    if partial_pull:
        emit(
            "warn",
            (
                f"Job is still {state_label} — this pull is a partial snapshot "
                "(trajectories / later stages may be incomplete)"
            ),
            3,
            partial=True,
        )
    resolved, source, tried = _resolve_remote_dir_for_job(
        session_id,
        local_dir=local,
        stored_path=remote_dir,
        job_id=jid,
        profile=profile,
    )
    if resolved and not source.startswith("unverified"):
        pull_source = resolved
        if resolved.rstrip("/") != remote_dir.rstrip("/"):
            pull_note_parts.append(f"remote path corrected via {source} ({resolved})")
            remote_dir = resolved
            emit("resolve", f"Using {source}: {resolved}", 5)
    else:
        emit("resolve", f"Using remote path {pull_source}", 5)

    if not remote_path_is_dir(session_id, pull_source):
        profile_scratch = ""
        if profile:
            profile_scratch = (_profile(profile).scratch_root or "").strip()
        scratch_job = resolve_scratch_job_dir(
            job_id=jid,
            execution=prior_execution,
            profile_scratch_root=profile_scratch,
            local_dir=local,
        )
        node = str(prior_execution.get("node_list") or "").split(",")[0].strip()
        if not node and jid:
            node = resolve_compute_node(session_id, jid)
        if scratch_job and node:
            emit("stage", f"Staging from scratch on {node}…", 8)
            staging_dir = f"/tmp/gw_pull_{jid or Path(local).name}"
            ok_stage, stage_msg = stage_scratch_to_login(
                session_id,
                node=node,
                scratch_job_dir=scratch_job,
                staging_dir=staging_dir,
                full=True,
            )
            if ok_stage and remote_path_is_dir(session_id, staging_dir):
                pull_source = staging_dir
                pull_note_parts.append(stage_msg)
                emit("stage", stage_msg, 12)
            else:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Remote directory not found. Tried: {', '.join(tried)}"
                        + (f", {node}:{scratch_job}" if scratch_job else "")
                        + f". {stage_msg if not ok_stage else 'Staging dir empty after scratch copy.'}"
                    ),
                )
        else:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Remote directory not found. Tried: {', '.join(tried)}"
                    if tried
                    else f"Remote directory not found: {remote_dir}"
                ),
            )

    def _sync_progress(evt: Dict[str, object]) -> None:
        if not on_progress:
            return
        payload = dict(evt)
        bytes_val = payload.get("bytes")
        total = payload.get("total_bytes")
        if (
            isinstance(bytes_val, (int, float))
            and isinstance(total, (int, float))
            and float(total) > 0
        ):
            payload["percent"] = max(
                0, min(99, int(100.0 * float(bytes_val) / float(total)))
            )
        elif isinstance(payload.get("percent"), (int, float)):
            payload["percent"] = int(
                max(0, min(100, float(payload["percent"])))
            )
        if not payload.get("message"):
            payload["message"] = "Downloading…"
        on_progress(payload)

    emit("measure", "Measuring remote folder size…", 10)
    remote_bytes = 0
    try:
        remote_bytes = remote_dir_byte_size(session_id, pull_source)
    except Exception:
        remote_bytes = 0
    try:
        from gatewizard.utils.equilibration_failure import PULL_PRESERVE_EXCLUDES as _pex

        start_local_bytes = local_dir_byte_size(local, excludes=list(_pex))
    except Exception:
        start_local_bytes = local_dir_byte_size(local)
    if remote_bytes > 0:
        emit(
            "sync",
            (
                f"Downloading… {format_byte_size(start_local_bytes)} / "
                f"{format_byte_size(remote_bytes)}"
                if start_local_bytes > 0
                else f"Downloading… 0 / {format_byte_size(remote_bytes)}"
            ),
            (
                max(0, min(99, int(100.0 * start_local_bytes / remote_bytes)))
                if remote_bytes > 0 and start_local_bytes > 0
                else 0
            ),
            bytes=int(start_local_bytes or 0),
            total_bytes=remote_bytes,
        )
    else:
        emit(
            "sync",
            (
                f"Downloading… {format_byte_size(start_local_bytes)} on disk"
                if start_local_bytes > 0
                        else "Downloading from cluster…"
            ),
            0,
            **({"bytes": int(start_local_bytes)} if start_local_bytes > 0 else {}),
        )

    # Remember remote size on the card even if the client misses stream events.
    if remote_bytes > 0:
        prior_execution["remote_bytes"] = int(remote_bytes)
        prior_execution["sizes_checked_at"] = datetime.now(timezone.utc).isoformat()
        try:
            write_execution_metadata(local, prior_execution)
        except Exception:
            pass

    try:
        rc, out, err = rsync_from_remote(
            session_id,
            pull_source,
            str(local),
            excludes=list(PULL_PRESERVE_EXCLUDES),
            # Live/partial: ignore-times so growing logs with stale WSL mtimes
            # still refresh. Completed jobs: size-only so a second concurrent
            # Pull does not re-read multi-GB files that already match.
            ignore_times=partial_pull,
            size_only=not partial_pull,
            on_progress=_sync_progress if on_progress else None,
            expected_bytes=remote_bytes or None,
            timeout=1800 if not remote_bytes else 600,
            cancel_event=cancel_event,
        )
    except PullCancelledError:
        raise
    except ClusterSSHError as ex:
        if cancel_event and cancel_event.is_set():
            raise PullCancelledError() from ex
        raise HTTPException(status_code=400, detail=str(ex)) from ex
    finally:
        if staging_dir:
            try:
                run_remote(
                    session_id,
                    f"rm -rf {shlex.quote(staging_dir)}",
                    timeout=30,
                )
            except Exception:
                pass

    if rc != 0:
        detail = (err or out or "pull failed").strip()
        if remote_state and str(remote_state).upper() in {
            "PENDING",
            "CONFIGURING",
            "REQUEUED",
        }:
            detail = (
                f"Pull failed while job is still {remote_state}. "
                "Results are not on the submit directory yet (scratch staging). "
                f"Transport error: {detail}"
            )
        raise HTTPException(status_code=400, detail=detail)

    emit("finalize", "Updating local metadata…", None)
    try:
        import json as _json
        import shlex as _shlex

        remote_job = f"{str(remote_dir).rstrip('/')}/equilibration_job.json"
        _rc_m, out_m, _err_m = run_remote(
            session_id,
            "python3 -c "
            + _shlex.quote(
                "import json;print(json.dumps(json.load(open("
                + repr(remote_job)
                + "))))"
            )
            + " 2>/dev/null || true",
            timeout=30,
        )
        if out_m.strip():
            remote_meta = _json.loads(out_m.strip().splitlines()[-1])
            if isinstance(remote_meta, dict):
                local_meta = read_job_metadata(local)
                changed = False
                for key in ("protocol", "input_dir", "ensemble", "engine"):
                    if not local_meta.get(key) and remote_meta.get(key):
                        local_meta[key] = remote_meta[key]
                        changed = True
                remote_exec = (
                    remote_meta.get("execution")
                    if isinstance(remote_meta.get("execution"), dict)
                    else {}
                )
                if remote_exec.get("scheduler_job_id"):
                    local_exec = dict(local_meta.get("execution") or {})
                    newer = _prefer_newer_execution(local_exec, remote_exec)
                    if newer.get("scheduler_job_id") != local_exec.get("scheduler_job_id"):
                        local_meta["execution"] = newer
                        changed = True
                if changed:
                    (local / "equilibration_job.json").write_text(
                        _json.dumps(local_meta, indent=2), encoding="utf-8"
                    )
    except Exception:
        pass

    # Restore / merge local execution so the card stays in Remote manage mode.
    current_execution = dict(read_job_metadata(local).get("execution") or {})
    merged = _prefer_newer_execution(current_execution, prior_execution)
    effective_jid = str(merged.get("scheduler_job_id") or job_id or "").strip()
    if effective_jid:
        merged["scheduler_job_id"] = effective_jid
    live_state = _query_slurm_job_state(session_id, effective_jid) if effective_jid else ""
    if live_state:
        merged["last_remote_state"] = live_state
    elif remote_state:
        merged["last_remote_state"] = remote_state
    merged.setdefault("mode", "remote")
    for key in (
        "remote_path",
        "cluster_id",
        "cluster_name",
        "submitted_at",
    ):
        if not merged.get(key) and prior_execution.get(key):
            merged[key] = prior_execution[key]

    state_u = str(merged.get("last_remote_state") or "").upper()
    active = state_u in {
        "PENDING",
        "RUNNING",
        "CONFIGURING",
        "COMPLETING",
        "REQUEUED",
    }
    # While the new job is still live, ignore leftovers older than this submit.
    newer_than = parse_submitted_at(merged)
    fail_msg, fail_src = find_equilibration_failure(local, newer_than=newer_than)
    note = summarize_slurm_outputs(local) if fail_msg else None
    if fail_msg and not active:
        merged["last_error"] = fail_msg
        if fail_src:
            merged["last_error_source"] = fail_src
        if note:
            merged["last_error_note"] = note
        if state_u in {"COMPLETED", "COMPLETE"}:
            merged["last_remote_state"] = "FAILED"
    elif active:
        # Do not keep a prior attempt's red banner while Slurm says RUNNING.
        merged["last_error"] = None
        merged["last_error_source"] = None
        merged["last_error_note"] = None

    merged["last_sync_at"] = datetime.now(timezone.utc).isoformat()
    # Keep submit resources even if an older pull thinned execution metadata.
    merged = enrich_execution_resources(local, merged)
    from gatewizard.utils.cluster.midrun import parse_scratch_workdir_from_slurm

    if not merged.get("scratch_root") or str(merged.get("scratch_root", "")).startswith("$"):
        parsed_root, parsed_strategy = parse_scratch_workdir_from_slurm(local)
        if parsed_root:
            merged["scratch_root"] = parsed_root
        if parsed_strategy and not merged.get("workdir_strategy"):
            merged["workdir_strategy"] = parsed_strategy
    if pull_source != remote_dir and pull_source and not str(pull_source).startswith("/tmp/gw_pull"):
        merged["remote_path"] = pull_source
    try:
        from gatewizard.utils.equilibration_failure import PULL_PRESERVE_EXCLUDES as _ex

        local_after = local_dir_byte_size(local, excludes=list(_ex))
    except Exception:
        local_after = local_dir_byte_size(local)
    if local_after:
        merged["local_bytes"] = int(local_after)
    if remote_bytes:
        merged["remote_bytes"] = int(remote_bytes)
    merged["sizes_checked_at"] = datetime.now(timezone.utc).isoformat()
    write_execution_metadata(local, merged)

    emit(
        "done",
        (
            f"Partial pull complete (job still {state_u}) — pull again when finished"
            if active
            else "Pull complete"
        ),
        100,
        partial=bool(active),
    )
    if active:
        pull_note_parts.append(
            f"partial pull while job was {merged.get('last_remote_state') or state_u}"
        )
    return {
        "ok": True,
        "stdout": out,
        "stderr": err,
        "execution": merged,
        "failure": None if active else fail_msg,
        "failure_source": None if active else fail_src,
        "slurm_note": None if active else note,
        "remote_state": merged.get("last_remote_state"),
        "pull_source": pull_source if pull_source != remote_dir else remote_dir,
        "pull_note": "; ".join(pull_note_parts) if pull_note_parts else None,
        "partial": bool(active),
        "local_bytes": int(local_after or 0),
        "remote_bytes": int(remote_bytes or 0) or None,
        "local_formatted": format_byte_size(int(local_after or 0)),
        "remote_formatted": format_byte_size(int(remote_bytes)) if remote_bytes else None,
    }


@router.post("/job-status")
def cluster_job_status(payload: ClusterJobStatusRequest) -> dict:
    """Watching uses a separate SSH ControlMaster from Pull/submit."""
    with ssh_channel("watch"):
        return _cluster_job_status(payload)


def _cluster_job_status(payload: ClusterJobStatusRequest) -> dict:
    session_id = _resolve_session_id(
        payload.session_id, payload.profile, payload.password
    )
    payload.password = None
    adapter = get_scheduler("slurm")

    prev_exec: Dict[str, Any] = {}
    effective_jid = str(payload.job_id or "").strip()
    if payload.local_dir:
        meta = read_job_metadata(Path(payload.local_dir))
        if isinstance(meta.get("execution"), dict):
            prev_exec = meta["execution"]
        stored_jid = str(prev_exec.get("scheduler_job_id") or "").strip()
        request_jid = effective_jid
        if request_jid and request_jid != stored_jid:
            candidate = _prefer_newer_execution(
                prev_exec,
                {**prev_exec, "scheduler_job_id": request_jid},
            )
            effective_jid = str(candidate.get("scheduler_job_id") or request_jid or stored_jid)
        elif stored_jid:
            effective_jid = stored_jid

    if not effective_jid and payload.local_dir:
        recovered = _recover_missing_job_identity(
            session_id,
            Path(payload.local_dir),
            profile=payload.profile,
            remote_dir=payload.remote_dir,
        )
        effective_jid = str(recovered.get("scheduler_job_id") or "").strip()
        if recovered:
            prev_exec = {**prev_exec, **recovered}

    if not effective_jid:
        if payload.local_dir:
            return {
                "jobs": [],
                "state": "",
                "stdout": "",
                "stderr": (
                    "No Slurm job id in local metadata, and the cluster has no "
                    "matching squeue/sacct job for this folder name."
                ),
                "pulled": None,
                "session_id": session_id,
                "execution": prev_exec or None,
            }
        raise HTTPException(
            status_code=400,
            detail=(
                "No Slurm job id in local metadata, and the cluster has no matching "
                "squeue/sacct job for this folder name. Connect to the cluster and "
                "Reload after the job is visible in squeue, or re-submit."
            ),
        )

    cmd_parts = adapter.status_command(effective_jid)
    cmd = " ".join(shlex.quote(x) for x in cmd_parts)
    try:
        rc, out, err = run_remote(session_id, cmd, timeout=60)
    except ClusterSSHError as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex

    handles = adapter.parse_status(out, job_id=effective_jid)
    state = canonicalize_slurm_state(handles[0].state if handles else "")
    if effective_jid and not handles:
        from gatewizard.utils.cluster.types import RemoteJobHandle

        acct_cmd = " ".join(
            shlex.quote(x) for x in adapter.accounting_command(effective_jid)
        )
        _rc2, out2, _err2 = run_remote(session_id, acct_cmd, timeout=60)
        if out2.strip():
            first = out2.strip().splitlines()[0]
            cols = first.split("|")
            if len(cols) >= 2:
                state = canonicalize_slurm_state(cols[1])
                handles = [
                    RemoteJobHandle(
                        scheduler="slurm",
                        job_id=str(effective_jid),
                        state=state,
                        raw=first,
                    )
                ]
    elif handles:
        # Keep handle.state aligned with the canonical value we persist.
        handles[0].state = state

    resolved_remote = (payload.remote_dir or "").strip().rstrip("/")
    remote_path_hint = resolved_remote or str(prev_exec.get("remote_path") or "")
    state_u = str(state or "").upper()
    if state_u in {"CANCELLED", "FAILED", "TIMEOUT", "COMPLETED", "COMPLETE", "NODE_FAIL"}:
        remote_exec = _fetch_remote_execution(session_id, remote_path_hint)
        if remote_exec.get("scheduler_job_id"):
            newer = _prefer_newer_execution(prev_exec, remote_exec)
            new_jid = str(newer.get("scheduler_job_id") or "").strip()
            if new_jid and new_jid != effective_jid:
                effective_jid = new_jid
                live = _query_slurm_job_state(session_id, effective_jid)
                if live:
                    state = live
                    state_u = live.upper()
                    from gatewizard.utils.cluster.types import RemoteJobHandle

                    handles = [
                        RemoteJobHandle(
                            scheduler="slurm",
                            job_id=effective_jid,
                            state=state,
                            raw=f"{effective_jid}|{state}",
                        )
                    ]
                prev_exec = newer

    if payload.local_dir and state:
        local = Path(payload.local_dir)
        if not prev_exec:
            meta = read_job_metadata(local)
            prev_exec = meta.get("execution") if isinstance(meta.get("execution"), dict) else {}
        stored = payload.remote_dir or prev_exec.get("remote_path") or ""
        jid = effective_jid or str(prev_exec.get("scheduler_job_id") or "")
        if jid:
            resolved, source, _ = _resolve_remote_dir_for_job(
                session_id,
                local_dir=local,
                stored_path=str(stored),
                job_id=jid,
                profile=payload.profile,
            )
            if resolved and not source.startswith("unverified"):
                resolved_remote = resolved

        fields: Dict[str, Any] = {
            "last_remote_state": state,
            "scheduler_job_id": effective_jid,
            "mode": "remote",
        }
        # Re-stamp profile identity so Watching keeps working after thin pulls.
        if payload.profile:
            cp = _profile(payload.profile)
            if cp.id:
                fields["cluster_id"] = cp.id
            if cp.name:
                fields["cluster_name"] = cp.name
        if resolved_remote:
            fields["remote_path"] = resolved_remote
        if handles:
            h0 = handles[0]
            if h0.node_list:
                node = h0.node_list.split(",")[0].strip()
                fields["node_list"] = node
                try:
                    meta = read_job_metadata(local)
                    prev = (
                        meta.get("execution")
                        if isinstance(meta.get("execution"), dict)
                        else {}
                    )
                    need_gres = (
                        not prev.get("node_gpu_label")
                        or str(prev.get("node_list") or "") != node
                    )
                    if need_gres:
                        gres = query_node_gres(session_id, node)
                        if gres:
                            fields["node_gres"] = gres
                            fields["node_gpu_label"] = summarize_node_gpu_label(gres)
                except Exception:
                    pass
            if getattr(h0, "cpus", 0):
                fields["allocated_cpus"] = int(h0.cpus)
            if h0.partition:
                fields["partition"] = h0.partition
        update_execution_fields(local, **fields)
        # Recover submit CPUs/GPUs from #SBATCH when execution.resources was lost.
        enriched = enrich_execution_resources(local)
        if getattr(handles[0] if handles else None, "cpus", 0):
            enriched["allocated_cpus"] = int(handles[0].cpus)
            res = dict(enriched.get("resources") or {})
            res["cpus"] = int(handles[0].cpus)
            enriched["resources"] = res
        write_execution_metadata(local, enriched)

    pulled = None
    state_u = str(state or "").upper()
    # Auto-pull logs once the job has left the queue (or is running).
    # PENDING has nothing useful in submit dir yet under scratch strategies.
    should_pull = bool(
        payload.pull_logs
        and resolved_remote
        and payload.local_dir
        and state_u
        and state_u not in {"PENDING", "CONFIGURING", "REQUEUED"}
    )
    if should_pull:
        # While RUNNING under scratch_*, stage logs live on the compute node —
        # sync them to the submit dir before the lightweight log pull.
        node_hint = ""
        if handles and handles[0].node_list:
            node_hint = handles[0].node_list
        midrun_note = _midrun_sync_progress(
            session_id,
            local_dir=Path(payload.local_dir),
            remote_dir=resolved_remote,
            job_id=effective_jid,
            node_hint=node_hint,
            profile=payload.profile,
            remote_state=state_u,
        )

        try:
            # Watching uses logs-only sync (not full Pull / trajectories).
            pulled = _pull_progress_logs(
                session_id,
                resolved_remote,
                Path(payload.local_dir),
                profile=payload.profile,
                job_id=effective_jid,
                # After COMPLETED, rewrite logs that are not a clean prefix
                # (--append would leave truncated NAMD stage logs stuck).
                append=state_u not in {"COMPLETED", "COMPLETE"},
            )
            if midrun_note and isinstance(pulled, dict):
                pulled["midrun"] = midrun_note
        except HTTPException as ex:
            pulled = {"ok": False, "stderr": str(ex.detail), "midrun": midrun_note}
        except ClusterSSHError as ex:
            pulled = {"ok": False, "stderr": str(ex), "midrun": midrun_note}
    elif payload.pull_logs and state_u in {"PENDING", "CONFIGURING", "REQUEUED"}:
        pulled = {
            "ok": True,
            "skipped": True,
            "reason": f"Job is {state_u}; outputs are not ready to pull yet",
        }

    return {
        "jobs": [h.to_dict() for h in handles],
        "state": state,
        "stdout": out,
        "stderr": err,
        "pulled": pulled,
        "session_id": session_id,
        "execution": (
            update_execution_fields(Path(payload.local_dir))
            if payload.local_dir
            else None
        ),
    }


@router.post("/cancel-job")
def cluster_cancel_job(payload: ClusterCancelRequest) -> dict:
    adapter = get_scheduler("slurm")
    cmd = " ".join(shlex.quote(x) for x in adapter.cancel_command(payload.job_id))
    try:
        rc, out, err = run_remote(payload.session_id, cmd, timeout=30)
    except ClusterSSHError as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex
    if rc != 0:
        raise HTTPException(status_code=400, detail=err or out or "scancel failed")
    if payload.local_dir:
        update_execution_fields(
            Path(payload.local_dir), last_remote_state="CANCELLED"
        )
    return {"ok": True, "stdout": out}


@router.post("/pull-job")
def cluster_pull_job(payload: ClusterPullRequest) -> dict:
    local = Path(payload.local_dir)
    remote_state = None
    job_id = payload.job_id
    try:
        execution = read_job_metadata(local).get("execution") or {}
        remote_state = execution.get("last_remote_state")
        job_id = _resolve_stored_job_id(local, job_id or execution.get("scheduler_job_id"))
    except Exception:
        pass
    if job_id:
        try:
            live = _query_slurm_job_state(payload.session_id, str(job_id))
            if live:
                remote_state = live
        except ClusterSSHError:
            pass
    midrun_note = _midrun_sync_progress(
        payload.session_id,
        local_dir=local,
        remote_dir=payload.remote_dir,
        job_id=str(job_id) if job_id else None,
        profile=payload.profile,
        remote_state=remote_state,
    )
    result = _pull_job_files(
        payload.session_id,
        payload.remote_dir,
        local,
        remote_state=remote_state,
        profile=payload.profile,
        job_id=str(job_id) if job_id else None,
    )
    if midrun_note and isinstance(result, dict):
        result["midrun"] = midrun_note
    return result


@router.post("/cancel-pull")
def cluster_cancel_pull(payload: ClusterCancelPullRequest) -> dict:
    """Stop an in-flight pull for a local job folder (kills rsync / SFTP)."""
    local = Path(os.path.abspath(os.path.expanduser(payload.local_dir)))
    cancelled = _request_pull_cancel(local)
    return {
        "cancelled": cancelled,
        "message": "Pull cancel requested" if cancelled else "No active pull for this folder",
    }


@router.post("/pull-job-stream")
async def cluster_pull_job_stream(
    request: Request, payload: ClusterPullRequest
) -> StreamingResponse:
    """NDJSON stream of pull progress events, ending with ``phase=done|error``."""
    import asyncio

    local = Path(payload.local_dir)
    remote_state = None
    job_id = payload.job_id
    try:
        execution = read_job_metadata(local).get("execution") or {}
        remote_state = execution.get("last_remote_state")
        job_id = _resolve_stored_job_id(local, job_id or execution.get("scheduler_job_id"))
    except Exception:
        pass
    if job_id:
        try:
            live = _query_slurm_job_state(payload.session_id, str(job_id))
            if live:
                remote_state = live
        except ClusterSSHError:
            pass

    async def event_stream():
        progress_q: queue.Queue = queue.Queue()
        cancel_event = _register_pull_cancel(local)

        def on_progress(evt: Dict[str, Any]) -> None:
            progress_q.put(("progress", evt))

        def worker() -> None:
            try:
                on_progress(
                    {
                        "phase": "resolve",
                        "percent": 0,
                        "message": "Connecting / preparing pull…",
                    }
                )
                midrun_note = _midrun_sync_progress(
                    payload.session_id,
                    local_dir=local,
                    remote_dir=payload.remote_dir,
                    job_id=str(job_id) if job_id else None,
                    profile=payload.profile,
                    remote_state=remote_state,
                )
                if midrun_note:
                    on_progress(
                        {
                            "phase": "stage",
                            "percent": 10,
                            "message": midrun_note,
                        }
                    )
                result = _pull_job_files(
                    payload.session_id,
                    payload.remote_dir,
                    local,
                    remote_state=remote_state,
                    profile=payload.profile,
                    job_id=str(job_id) if job_id else None,
                    on_progress=on_progress,
                    cancel_event=cancel_event,
                )
                if midrun_note and isinstance(result, dict):
                    result["midrun"] = midrun_note
                progress_q.put(("done", result))
            except PullCancelledError:
                progress_q.put(("cancelled", {"message": "Pull cancelled"}))
            except HTTPException as ex:
                detail = ex.detail
                msg = detail if isinstance(detail, str) else str(detail)
                progress_q.put(("error", {"message": msg, "status_code": ex.status_code}))
            except ClusterSSHError as ex:
                progress_q.put(("error", {"message": str(ex)}))
            except Exception as ex:
                progress_q.put(("error", {"message": str(ex)}))
            finally:
                _unregister_pull_cancel(local)
                progress_q.put(None)

        threading.Thread(target=worker, daemon=True).start()
        loop = asyncio.get_running_loop()
        while True:
            if await request.is_disconnected():
                cancel_event.set()
            try:
                item = await asyncio.wait_for(
                    loop.run_in_executor(None, progress_q.get),
                    timeout=0.25,
                )
            except asyncio.TimeoutError:
                continue
            if item is None:
                break
            kind, payload_evt = item
            if kind == "progress":
                yield json.dumps(payload_evt, ensure_ascii=False) + "\n"
            elif kind == "done":
                partial = bool(payload_evt.get("partial")) if isinstance(payload_evt, dict) else False
                state = ""
                if isinstance(payload_evt, dict):
                    state = str(payload_evt.get("remote_state") or "")
                yield json.dumps(
                    {
                        "phase": "done",
                        "percent": 100,
                        "partial": partial,
                        "message": (
                            f"Partial pull complete (job still {state}) — pull again when finished"
                            if partial
                            else "Pull complete"
                        ),
                        "result": payload_evt,
                    },
                    ensure_ascii=False,
                ) + "\n"
            elif kind == "cancelled":
                yield json.dumps(
                    {
                        "phase": "cancelled",
                        "percent": None,
                        "message": payload_evt.get("message") or "Pull cancelled",
                        "cancelled": True,
                    },
                    ensure_ascii=False,
                ) + "\n"
            elif kind == "error":
                yield json.dumps(
                    {
                        "phase": "error",
                        "percent": None,
                        "message": payload_evt.get("message") or "Pull failed",
                        "error": payload_evt.get("message") or "Pull failed",
                    },
                    ensure_ascii=False,
                ) + "\n"
            # Let the event loop flush the chunk to the client immediately.
            await asyncio.sleep(0)

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Content-Encoding": "identity",
        },
    )


@router.post("/local-dir-size")
def cluster_local_dir_size(payload: ClusterLocalDirSizeRequest) -> dict:
    """Sum bytes under a local job folder (used for live Pull progress when stream stalls)."""
    root = Path(payload.local_dir)
    if not root.is_dir():
        return {"bytes": 0, "formatted": "0 B", "exists": False}
    try:
        from gatewizard.utils.equilibration_failure import PULL_PRESERVE_EXCLUDES

        excludes = list(payload.excludes or PULL_PRESERVE_EXCLUDES)
    except Exception:
        excludes = list(payload.excludes or [])
    nbytes = local_dir_byte_size(root, excludes=excludes)
    return {
        "bytes": nbytes,
        "formatted": format_byte_size(nbytes),
        "exists": True,
    }


@router.post("/job-folder-sizes")
def cluster_job_folder_sizes(payload: ClusterJobFolderSizesRequest) -> dict:
    """Local (+ optional remote) folder byte totals for Pull sync indicators."""
    try:
        from gatewizard.utils.equilibration_failure import PULL_PRESERVE_EXCLUDES

        excludes = list(payload.excludes or PULL_PRESERVE_EXCLUDES)
    except Exception:
        excludes = list(payload.excludes or [])

    root = Path(payload.local_dir)
    local_bytes = local_dir_byte_size(root, excludes=excludes) if root.is_dir() else 0
    remote_bytes = 0
    remote_error = None
    remote_path = (payload.remote_dir or "").strip().rstrip("/")
    if payload.measure_remote and payload.session_id and remote_path:
        try:
            remote_bytes = remote_dir_byte_size(payload.session_id, remote_path)
        except Exception as ex:
            remote_error = str(ex)
            remote_bytes = 0

    # Persist last known sizes on the job so cards survive reloads offline.
    if root.is_dir() and (local_bytes or remote_bytes):
        try:
            meta = read_job_metadata(root)
            execution = dict(meta.get("execution") or {})
            if local_bytes:
                execution["local_bytes"] = int(local_bytes)
            if remote_bytes:
                execution["remote_bytes"] = int(remote_bytes)
            execution["sizes_checked_at"] = datetime.now(timezone.utc).isoformat()
            write_execution_metadata(root, execution)
        except Exception:
            pass

    return {
        "local_bytes": local_bytes,
        "remote_bytes": remote_bytes or None,
        "local_formatted": format_byte_size(local_bytes),
        "remote_formatted": format_byte_size(remote_bytes) if remote_bytes else None,
        "ratio": (
            min(1.0, float(local_bytes) / float(remote_bytes))
            if remote_bytes and remote_bytes > 0
            else None
        ),
        "remote_error": remote_error,
    }
