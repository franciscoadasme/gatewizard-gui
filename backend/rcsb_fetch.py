"""Download an RCSB entry as legacy PDB, or mmCIF when PDB is not published."""

from __future__ import annotations

from pathlib import Path

import requests

from mmcif_pdb import StructureConvertError, pdb_from_mmcif

_USER_AGENT = "gatewizard-gui"
_TIMEOUT = (10, 120)
_PDB_STARTS = (
    b"HEADER",
    b"OBSLTE",
    b"TITLE",
    b"CAVEAT",
    b"COMPND",
    b"SOURCE",
    b"KEYWDS",
    b"EXPDTA",
    b"AUTHOR",
    b"REVDAT",
    b"SPRSDE",
    b"JRNL",
    b"REMARK",
    b"DBREF",
    b"SEQADV",
    b"SEQRES",
    b"MODRES",
    b"HET",
    b"HETNAM",
    b"HETSYN",
    b"FORMUL",
    b"HELIX",
    b"SHEET",
    b"SSBOND",
    b"LINK",
    b"CISPEP",
    b"SITE",
    b"CRYST1",
    b"ORIGX",
    b"SCALE",
    b"MTRIX",
    b"MODEL",
    b"ATOM",
    b"ANISOU",
    b"TER",
    b"HETATM",
    b"CONECT",
    b"MASTER",
    b"END",
    b"NUMMDL",
)


class RcsbDownloadError(Exception):
    """RCSB did not return a usable PDB or mmCIF file."""


def download_rcsb_entry(pdb_id: str, dest_dir: Path) -> Path:
    """Save ``{id}.pdb`` when RCSB publishes it, otherwise mmCIF converted to PDB.

    Entries such as 5GOA have no legacy PDB file (HTTP 404): they have more
    atoms than the 99,999 decimal serial limit. The mmCIF is downloaded and
    written as a PDB with hybrid-36 serials so MDAnalysis can open it.
    """
    code = pdb_id.strip().upper()
    if len(code) != 4 or not code.isalnum():
        raise RcsbDownloadError(f"Not a PDB ID: {pdb_id}")
    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    lower = code.lower()
    attempts = (
        ("pdb", f"https://files.rcsb.org/download/{lower}.pdb"),
        ("cif", f"https://files.rcsb.org/download/{lower}.cif"),
    )
    errors: list[str] = []
    for kind, url in attempts:
        try:
            resp = requests.get(
                url,
                timeout=_TIMEOUT,
                headers={"User-Agent": _USER_AGENT},
                allow_redirects=True,
            )
        except requests.RequestException as ex:
            errors.append(f"{kind}: {ex}")
            continue
        if resp.status_code == 404:
            errors.append(f"{kind}: not published (HTTP 404)")
            continue
        if resp.status_code >= 400:
            errors.append(f"{kind}: HTTP {resp.status_code}")
            continue
        body = resp.content or b""
        if not _looks_like_structure(kind, body):
            errors.append(f"{kind}: response was not a structure file")
            continue
        if kind == "pdb":
            path = dest_dir / f"{lower}.pdb"
            path.write_bytes(body)
            return path
        if kind == "cif":
            cif_path = dest_dir / f"{lower}.cif"
            cif_path.write_bytes(body)
            try:
                return pdb_from_mmcif(cif_path)
            except StructureConvertError as ex:
                raise RcsbDownloadError(
                    f"RCSB published {code} as mmCIF only, and it could not be "
                    f"converted to PDB: {ex}"
                ) from ex
        raise RcsbDownloadError(f"Unknown download kind {kind}")
    detail = "; ".join(errors) if errors else "no file"
    raise RcsbDownloadError(
        f"RCSB has no usable PDB or mmCIF file for {code} ({detail})"
    )


def _looks_like_html(sample: bytes) -> bool:
    head = sample.lstrip()[:64].lower()
    return (
        head.startswith(b"<!doctype")
        or head.startswith(b"<html")
        or head.startswith(b"<head")
    )


def _looks_like_structure(kind: str, body: bytes) -> bool:
    sample = body[:8192]
    if not sample or _looks_like_html(sample):
        return False
    if kind == "cif":
        return b"data_" in sample[:512] or b"_atom_site" in sample
    if kind == "pdb":
        for raw in sample.splitlines():
            line = raw.strip()
            if not line or line.startswith(b"#"):
                continue
            return line.startswith(_PDB_STARTS)
        return False
    raise ValueError(f"Unknown structure kind: {kind}")
