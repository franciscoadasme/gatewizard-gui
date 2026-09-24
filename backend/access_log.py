"""Quiet routine 2xx access lines for folder-scan / job-status polls."""

from __future__ import annotations

import logging
from typing import Any

POLL_ACCESS_PATHS = (
    "/project-status",
    "/scan-tools-jobs",
    "/scan-jobs",
    "/job-status",
    "/scan-analysis-sessions",
)


def _path_only(path: str) -> str:
    raw = str(path or "").strip()
    if not raw:
        return ""
    return raw.split("?", 1)[0]


def is_poll_access_path(path: str) -> bool:
    p = _path_only(path)
    for prefix in POLL_ACCESS_PATHS:
        if p == prefix or p.startswith(f"{prefix}/"):
            return True
    return False


def should_log_access(path: str, status: int) -> bool:
    try:
        code = int(status)
    except (TypeError, ValueError):
        return True
    if code >= 400:
        return True
    return not is_poll_access_path(path)


def _record_path_and_status(record: logging.LogRecord) -> tuple[str | None, int | None]:
    args: Any = record.args
    if isinstance(args, dict):
        path = args.get("path") or args.get("full_path")
        status = args.get("status") or args.get("status_code")
        if path is not None and status is not None:
            return str(path), int(status)
    if isinstance(args, (tuple, list)) and len(args) >= 5:
        # uvicorn: client, method, path, http_version, status
        try:
            return str(args[2]), int(args[4])
        except (TypeError, ValueError):
            return None, None
    return None, None


class PollAccessFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        path, status = _record_path_and_status(record)
        if path is None or status is None:
            return True
        return should_log_access(path, status)


def attach_poll_access_filter() -> None:
    logger = logging.getLogger("uvicorn.access")
    if any(isinstance(f, PollAccessFilter) for f in logger.filters):
        return
    logger.addFilter(PollAccessFilter())
