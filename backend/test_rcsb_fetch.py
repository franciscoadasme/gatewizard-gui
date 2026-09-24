"""RCSB download prefers PDB and falls back to mmCIF when PDB is missing."""

from pathlib import Path

import requests

from rcsb_fetch import RcsbDownloadError, download_rcsb_entry
from test_mmcif_pdb import TINY_CIF


class _Resp:
    def __init__(self, status: int, body: bytes):
        self.status_code = status
        self.content = body


def _install(monkeypatch, bodies: dict[str, _Resp], calls: list[str]):
    def fake_get(url, timeout=None, headers=None, allow_redirects=True):
        calls.append(url)
        for suffix, resp in bodies.items():
            if url.endswith(suffix):
                return resp
        raise AssertionError(url)

    monkeypatch.setattr(requests, "get", fake_get)


def test_falls_back_to_cif_when_pdb_is_missing(tmp_path: Path, monkeypatch):
    calls: list[str] = []
    _install(
        monkeypatch,
        {
            ".pdb": _Resp(404, b"<!DOCTYPE html><html>missing</html>"),
            ".cif": _Resp(200, TINY_CIF.encode("utf-8")),
        },
        calls,
    )
    path = download_rcsb_entry("5goa", tmp_path)
    assert path.name == "5goa.pdb"
    assert b"ATOM" in path.read_bytes()
    assert calls == [
        "https://files.rcsb.org/download/5goa.pdb",
        "https://files.rcsb.org/download/5goa.cif",
    ]


def test_keeps_pdb_when_published(tmp_path: Path, monkeypatch):
    calls: list[str] = []
    _install(
        monkeypatch,
        {".pdb": _Resp(200, b"HEADER    TEST\nATOM      1  N   ALA A   1\n")},
        calls,
    )
    path = download_rcsb_entry("1CRN", tmp_path)
    assert path.suffix == ".pdb"
    assert len(calls) == 1


def test_rejects_html_pdb_and_uses_cif(tmp_path: Path, monkeypatch):
    _install(
        monkeypatch,
        {
            ".pdb": _Resp(200, b"<html><body>gone</body></html>"),
            ".cif": _Resp(200, TINY_CIF.encode("utf-8")),
        },
        [],
    )
    path = download_rcsb_entry("5GOA", tmp_path)
    assert path.suffix == ".pdb"


def test_both_missing_raises(tmp_path: Path, monkeypatch):
    _install(
        monkeypatch,
        {
            ".pdb": _Resp(404, b"missing"),
            ".cif": _Resp(404, b"missing"),
        },
        [],
    )
    try:
        download_rcsb_entry("5GOA", tmp_path)
    except RcsbDownloadError as ex:
        assert "5GOA" in str(ex)
        assert "404" in str(ex)
    else:
        raise AssertionError("expected RcsbDownloadError")
