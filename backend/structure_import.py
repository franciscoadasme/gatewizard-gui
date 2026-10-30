"""Inspect and materialize multi-entry structure sources for Visualize.

Supports:
- Maestro ``.mae`` / ``.maegz`` (RDKit MaeMolSupplier; Open Babel fallback)
- Multi-MODEL PDB (``MODEL`` / ``ENDMDL``)
- Multi-molecule SDF / SD (RDKit SDMolSupplier; MOL2 is single-entry)
- Single-file pass-through (PDB/CIF/GRO/XYZ/…)

Each selected entry is written as a single-frame PDB under a content-addressed
cache so ``/get-structure`` and edits keep a simple path.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Optional


def _cache_root() -> Path:
    override = os.environ.get("GATEWIZARD_STRUCTURE_CACHE")
    if override:
        root = Path(override).expanduser().resolve()
    else:
        # Prefer Electron userData when the GUI sets GATEWIZARD_USER_DATA.
        user_data = os.environ.get("GATEWIZARD_USER_DATA")
        if user_data:
            root = Path(user_data).expanduser().resolve() / "structure_cache"
        else:
            xdg = os.environ.get("XDG_CONFIG_HOME")
            if xdg:
                root = Path(xdg) / "gatewizard-gui" / "structure_cache"
            else:
                root = Path.home() / ".config" / "gatewizard-gui" / "structure_cache"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _file_digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


def _is_maestro(path: Path) -> bool:
    suf = path.suffix.lower()
    if suf in {".mae", ".maegz"}:
        return True
    name = path.name.lower()
    return name.endswith(".mae.gz")


def _is_chem_file(path: Path) -> bool:
    return path.suffix.lower() in {".mol2", ".sdf", ".sd"}


def _count_pdb_models(path: Path) -> int:
    """Count MODEL records; 0 means a single implicit model (no MODEL keywords)."""
    n = 0
    with path.open("r", encoding="utf-8", errors="replace") as f:
        for line in f:
            if line.startswith("MODEL"):
                n += 1
    return n


def _entry_label(source: Path, kind: str, index: int, title: str | None = None) -> str:
    """Label as ``entry · sourceFile`` so titles/CTs sort before the shared filename."""
    base = source.name
    if title and title.strip():
        return f"{title.strip()} · {base}"
    if kind == "maestro_ct":
        return f"CT {index + 1} · {base}"
    if kind == "pdb_model":
        return f"model {index + 1} · {base}"
    if kind == "chem_mol":
        return f"mol {index + 1} · {base}"
    return base


# Prefer the API implementation (same rules as Visualize). Fall back when the
# installed gatewizard pin is older than the Maestro properties module.
try:
    from gatewizard.tools.maestro import maestro_ct_properties as _maestro_ct_properties
except ImportError:  # pragma: no cover - older gatewizard pin
    _MAESTRO_PROP_STRING_MAX = 500
    _MAESTRO_PROP_TYPES = {"r": "real", "i": "integer", "b": "boolean", "s": "string"}

    def _maestro_ct_properties(mol: Any) -> list[dict[str, Any]]:
        """CT-level Maestro properties from an RDKit molecule (local fallback)."""
        if mol is None:
            return []
        try:
            raw = mol.GetPropsAsDict(includePrivate=False, includeComputed=False)
        except Exception:
            raw = {}
            try:
                for name in mol.GetPropNames():
                    raw[name] = mol.GetProp(name)
            except Exception:
                return []

        out: list[dict[str, Any]] = []
        for name, value in raw.items():
            if not isinstance(name, str) or len(name) < 3:
                continue
            if name.startswith("_"):
                continue
            kind = _MAESTRO_PROP_TYPES.get(name[0])
            if kind is None or name[1] != "_":
                continue
            if kind == "string":
                text = str(value)
                if len(text) > _MAESTRO_PROP_STRING_MAX:
                    continue
                value = text
            elif kind == "real":
                try:
                    value = float(value)
                except (TypeError, ValueError):
                    continue
                if not (value == value):  # NaN
                    continue
            elif kind == "integer":
                try:
                    value = int(value)
                except (TypeError, ValueError):
                    continue
            else:
                value = bool(value)
            out.append({"name": name, "type": kind, "value": value})
        out.sort(key=lambda item: item["name"])
        return out


def inspect_structure_file(path: str | Path) -> dict[str, Any]:
    """Return ``{ kind, sourcePath, entries: [...] }`` without materializing."""
    p = Path(path).expanduser().resolve()
    if not p.is_file():
        raise FileNotFoundError(f"File not found: {p}")

    if _is_maestro(p):
        entries = _inspect_maestro(p)
        return {
            "kind": "maestro",
            "sourcePath": str(p),
            "entries": entries,
        }

    suf = p.suffix.lower()
    if suf in {".pdb", ".ent"}:
        n_models = _count_pdb_models(p)
        if n_models > 1:
            return {
                "kind": "pdb_models",
                "sourcePath": str(p),
                "entries": [
                    {
                        "index": i,
                        "label": _entry_label(p, "pdb_model", i),
                        "kind": "pdb_model",
                    }
                    for i in range(n_models)
                ],
            }

    if _is_chem_file(p):
        chem_entries = _inspect_chem(p)
        if chem_entries is not None and len(chem_entries) > 1:
            return {
                "kind": "chem_mols",
                "sourcePath": str(p),
                "entries": chem_entries,
            }

    return {
        "kind": "single",
        "sourcePath": str(p),
        "entries": [
            {
                "index": 0,
                "label": _entry_label(p, "file", 0),
                "kind": "file",
            }
        ],
    }


def _mol_title(mol: Any) -> str | None:
    if mol is None:
        return None
    for key in ("_Name", "name", "TITLE"):
        try:
            if mol.HasProp(key):
                title = str(mol.GetProp(key)).strip()
                if title:
                    return title
        except Exception:
            continue
    return None


def _inspect_chem(path: Path) -> list[dict[str, Any]] | None:
    """List molecules in MOL2/SDF. Returns None when RDKit cannot inspect."""
    try:
        from rdkit import Chem
    except ImportError:
        return None

    suf = path.suffix.lower()
    entries: list[dict[str, Any]] = []
    if suf == ".mol2":
        try:
            mol = Chem.MolFromMol2File(str(path), sanitize=False, removeHs=False)
        except Exception:
            return None
        if mol is None:
            return None
        return [
            {
                "index": 0,
                "label": _entry_label(path, "chem_mol", 0, _mol_title(mol)),
                "kind": "chem_mol",
            }
        ]

    try:
        supplier = Chem.SDMolSupplier(str(path), sanitize=False, removeHs=False)
    except Exception:
        return None
    for i, mol in enumerate(supplier):
        entries.append(
            {
                "index": i,
                "label": _entry_label(path, "chem_mol", i, _mol_title(mol)),
                "kind": "chem_mol",
            }
        )
    if not entries:
        return None
    return entries


def _inspect_maestro(path: Path) -> list[dict[str, Any]]:
    try:
        from gatewizard.tools.maestro import list_maestro_entries

        return list_maestro_entries(path)["entries"]
    except ImportError:
        pass
    except Exception as api_err:
        try:
            return _inspect_maestro_openbabel(path)
        except Exception as ob_err:
            raise RuntimeError(
                f"Could not read Maestro file {path.name}: "
                f"RDKit ({api_err}); Open Babel ({ob_err})"
            ) from ob_err

    try:
        return _inspect_maestro_rdkit(path)
    except Exception as rdkit_err:
        try:
            return _inspect_maestro_openbabel(path)
        except Exception as ob_err:
            raise RuntimeError(
                f"Could not read Maestro file {path.name}: "
                f"RDKit ({rdkit_err}); Open Babel ({ob_err})"
            ) from ob_err


def _open_mae_text_path(path: Path) -> Path:
    """Return a path to uncompressed .mae (temp file if .maegz)."""
    name = path.name.lower()
    if name.endswith(".maegz") or name.endswith(".mae.gz"):
        tmp = tempfile.NamedTemporaryFile(suffix=".mae", delete=False)
        tmp_path = Path(tmp.name)
        tmp.close()
        with gzip.open(path, "rb") as src, tmp_path.open("wb") as dst:
            shutil.copyfileobj(src, dst)
        return tmp_path
    return path


def _inspect_maestro_rdkit(path: Path) -> list[dict[str, Any]]:
    from rdkit import Chem

    mae_path = _open_mae_text_path(path)
    cleanup = mae_path != path
    try:
        supplier = Chem.MaeMolSupplier(str(mae_path), sanitize=False, removeHs=False)
        entries: list[dict[str, Any]] = []
        for i, mol in enumerate(supplier):
            if mol is None:
                continue
            title = None
            try:
                if mol.HasProp("_Name"):
                    title = str(mol.GetProp("_Name"))
            except Exception:
                title = None
            n_atoms = int(mol.GetNumAtoms()) if mol is not None else 0
            entries.append(
                {
                    "index": i,
                    "label": _entry_label(path, "maestro_ct", i, title),
                    "kind": "maestro_ct",
                    "atomCount": n_atoms,
                    "title": title,
                    "properties": _maestro_ct_properties(mol),
                }
            )
        if not entries:
            raise RuntimeError("No connection tables found")
        return entries
    finally:
        if cleanup:
            try:
                mae_path.unlink(missing_ok=True)
            except OSError:
                pass


def _inspect_maestro_openbabel(path: Path) -> list[dict[str, Any]]:
    """Count molecules via ``obabel -l`` / conversion probe."""
    obabel = shutil.which("obabel") or shutil.which("obabel.exe")
    if not obabel:
        raise RuntimeError("obabel not found on PATH")
    # Convert to SDF in a temp dir and count $$$$; listing without write is unreliable.
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "all.sdf"
        cmd = [obabel, str(path), "-O", str(out)]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if proc.returncode != 0 or not out.is_file():
            raise RuntimeError(proc.stderr.strip() or "obabel failed")
        text = out.read_text(encoding="utf-8", errors="replace")
        n = text.count("$$$$")
        if n <= 0:
            # single mol without trailing $$$$
            n = 1 if text.strip() else 0
        if n <= 0:
            raise RuntimeError("No molecules found via Open Babel")
        return [
            {
                "index": i,
                "label": _entry_label(path, "maestro_ct", i),
                "kind": "maestro_ct",
                "properties": [],
            }
            for i in range(n)
        ]


def import_structure_entries(
    path: str | Path,
    indices: list[int] | None = None,
) -> dict[str, Any]:
    """Materialize selected entries to cache PDBs.

    Returns ``{ sourcePath, kind, structures: [{ id, label, kind, path, … }] }``.
    """
    p = Path(path).expanduser().resolve()
    info = inspect_structure_file(p)
    kind = info["kind"]
    all_entries = info["entries"]
    if not all_entries:
        raise RuntimeError("No entries to import")

    if indices is None:
        chosen = list(range(len(all_entries)))
    else:
        chosen = sorted({int(i) for i in indices})
        for i in chosen:
            if i < 0 or i >= len(all_entries):
                raise ValueError(f"Entry index out of range: {i}")

    digest = _file_digest(p)
    out_dir = _cache_root() / digest
    out_dir.mkdir(parents=True, exist_ok=True)

    if kind == "single":
        return {
            "sourcePath": str(p),
            "kind": kind,
            "structures": [
                {
                    "sourcePath": str(p),
                    "kind": "file",
                    "label": all_entries[0]["label"],
                    "path": str(p),
                    "ctIndex": None,
                    "modelIndex": None,
                }
            ],
        }

    if kind == "pdb_models":
        structures = _materialize_pdb_models(p, chosen, out_dir, all_entries)
    elif kind == "maestro":
        structures = _materialize_maestro(p, chosen, out_dir, all_entries)
    elif kind == "chem_mols":
        structures = _materialize_chem(p, chosen, out_dir, all_entries)
    else:
        raise RuntimeError(f"Unsupported kind: {kind}")

    return {"sourcePath": str(p), "kind": kind, "structures": structures}


def _materialize_pdb_models(
    path: Path,
    indices: list[int],
    out_dir: Path,
    entries: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    try:
        return _materialize_pdb_models_mda(path, indices, out_dir, entries)
    except Exception:
        return _materialize_pdb_models_text(path, indices, out_dir, entries)


def _materialize_pdb_models_mda(
    path: Path,
    indices: list[int],
    out_dir: Path,
    entries: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    import MDAnalysis as mda
    from MDAnalysis.coordinates.PDB import PDBWriter

    u = mda.Universe(str(path))
    n_frames = len(u.trajectory)
    structures: list[dict[str, Any]] = []
    for i in indices:
        if i >= n_frames:
            raise ValueError(f"Model index {i} exceeds trajectory length {n_frames}")
        out_path = out_dir / f"model_{i:04d}.pdb"
        if not out_path.is_file() or out_path.stat().st_size == 0:
            u.trajectory[i]
            with PDBWriter(str(out_path), multiframe=False) as w:
                w.write(u.atoms)
        meta = entries[i] if i < len(entries) else {}
        structures.append(
            {
                "sourcePath": str(path),
                "kind": "pdb_model",
                "label": meta.get("label") or _entry_label(path, "pdb_model", i),
                "path": str(out_path),
                "pdbPath": str(out_path),
                "ctIndex": None,
                "modelIndex": i,
            }
        )
    return structures


def _materialize_pdb_models_text(
    path: Path,
    indices: list[int],
    out_dir: Path,
    entries: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Split MODEL/ENDMDL blocks without MDAnalysis (test / fallback)."""
    text = path.read_text(encoding="utf-8", errors="replace")
    blocks: list[str] = []
    current: list[str] = []
    in_model = False
    for line in text.splitlines(keepends=True):
        if line.startswith("MODEL"):
            in_model = True
            current = [line]
            continue
        if line.startswith("ENDMDL"):
            current.append(line)
            blocks.append("".join(current))
            current = []
            in_model = False
            continue
        if in_model:
            current.append(line)
    if not blocks:
        raise RuntimeError(f"No MODEL blocks found in {path.name}")

    structures: list[dict[str, Any]] = []
    for i in indices:
        if i < 0 or i >= len(blocks):
            raise ValueError(f"Model index {i} out of range (0..{len(blocks) - 1})")
        out_path = out_dir / f"model_{i:04d}.pdb"
        if not out_path.is_file() or out_path.stat().st_size == 0:
            out_path.write_text(blocks[i] + "END\n", encoding="utf-8")
        meta = entries[i] if i < len(entries) else {}
        structures.append(
            {
                "sourcePath": str(path),
                "kind": "pdb_model",
                "label": meta.get("label") or _entry_label(path, "pdb_model", i),
                "path": str(out_path),
                "pdbPath": str(out_path),
                "ctIndex": None,
                "modelIndex": i,
            }
        )
    return structures


def _materialize_chem(
    path: Path,
    indices: list[int],
    out_dir: Path,
    entries: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Write selected SDF/SD molecules as cache PDBs with bond-order sidecars."""
    from rdkit import Chem

    want = set(indices)
    structures: list[dict[str, Any]] = []
    supplier = Chem.SDMolSupplier(str(path), sanitize=False, removeHs=False)
    for i, mol in enumerate(supplier):
        if i not in want:
            continue
        if mol is None:
            raise RuntimeError(f"Molecule {i} failed to parse in {path.name}")
        out_path = out_dir / f"mol_{i:04d}.pdb"
        if not out_path.is_file() or out_path.stat().st_size == 0:
            block = Chem.MolToPDBBlock(mol)
            if not block or not block.strip():
                raise RuntimeError(f"Molecule {i}: empty PDB block from RDKit")
            out_path.write_text(block, encoding="utf-8")
        bond_orders = _bond_orders_from_mol(mol)
        orders_path = write_bond_orders_sidecar(out_path, bond_orders)
        meta = next((e for e in entries if e.get("index") == i), None) or (
            entries[i] if i < len(entries) else {}
        )
        structures.append(
            {
                "sourcePath": str(path),
                "kind": "chem_mol",
                "label": meta.get("label") or _entry_label(path, "chem_mol", i),
                "path": str(out_path),
                "pdbPath": str(out_path),
                "ctIndex": None,
                "modelIndex": i,
                "bondOrdersPath": str(orders_path),
            }
        )
    if len(structures) != len(want):
        missing = want - {s["modelIndex"] for s in structures}
        raise RuntimeError(f"Missing molecule indices: {sorted(missing)}")
    return structures


def _materialize_maestro(
    path: Path,
    indices: list[int],
    out_dir: Path,
    entries: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    try:
        return _materialize_maestro_rdkit(path, indices, out_dir, entries)
    except Exception:
        return _materialize_maestro_openbabel(path, indices, out_dir, entries)


def _bond_orders_from_mol(mol) -> list[list[int]]:
    """Return ``[[i, j, order], ...]`` using RDKit 0-based atom indices."""
    from rdkit import Chem

    def _collect(m) -> list[list[int]]:
        out: list[list[int]] = []
        for bond in m.GetBonds():
            a = int(bond.GetBeginAtomIdx())
            b = int(bond.GetEndAtomIdx())
            bt = bond.GetBondType()
            if bt == Chem.BondType.TRIPLE:
                order = 3
            elif bt == Chem.BondType.DOUBLE:
                order = 2
            else:
                try:
                    d = float(bond.GetBondTypeAsDouble())
                except Exception:
                    d = 1.0
                if d >= 2.75:
                    order = 3
                elif d >= 1.95:
                    order = 2
                else:
                    order = 1
            out.append([a, b, order])
        return out

    orders = _collect(mol)
    if any(o >= 2 for _, _, o in orders):
        return orders
    # sanitize=False MAE imports sometimes leave everything as SINGLE — retry.
    try:
        probe = Chem.Mol(mol)
        Chem.SanitizeMol(probe)
        sanitized = _collect(probe)
        if any(o >= 2 for _, _, o in sanitized):
            return sanitized
    except Exception:
        pass
    return orders


def annotate_bonds_with_orders(
    bonds: list | None,
    orders: list | None,
    *,
    selected: set[int] | None = None,
) -> list[list[int]]:
    """Merge bond-order sidecar onto connectivity pairs.

    Prefer densified/topology connectivity when present, attaching orders for
    matching ``(i,j)`` pairs. If the sidecar has double/triple bonds but none
    matched (index-space mismatch vs CONECT), fall back to the sidecar rows so
    multiple bonds still render.
    """
    order_map: dict[tuple[int, int], int] = {}
    for row in orders or []:
        if not isinstance(row, (list, tuple)) or len(row) < 2:
            continue
        i, j = int(row[0]), int(row[1])
        o = int(row[2]) if len(row) > 2 else 1
        if o < 1:
            o = 1
        if o > 3:
            o = 3
        order_map[(i, j) if i <= j else (j, i)] = o

    def _in_sel(i: int, j: int) -> bool:
        if selected is None:
            return True
        return i in selected and j in selected

    out: list[list[int]] = []
    seen: set[tuple[int, int]] = set()
    matched_multi = False

    for row in bonds or []:
        if not isinstance(row, (list, tuple)) or len(row) < 2:
            continue
        i, j = int(row[0]), int(row[1])
        if not _in_sel(i, j):
            continue
        key = (i, j) if i <= j else (j, i)
        if key in seen:
            continue
        seen.add(key)
        o = order_map.get(key, int(row[2]) if len(row) > 2 else 1)
        if o >= 2:
            matched_multi = True
        out.append([i, j, int(o)])

    sidecar_multi = any(o >= 2 for o in order_map.values())
    if (not out or (sidecar_multi and not matched_multi)) and order_map:
        out = []
        for (i, j), o in order_map.items():
            if not _in_sel(i, j):
                continue
            out.append([i, j, o])

    return out


def _bond_orders_from_chem_path(path: Path) -> Optional[list[list[int]]]:
    """Bond orders from a MOL2 / SDF / SD file via RDKit (first molecule)."""
    try:
        from rdkit import Chem
    except ImportError:
        return None
    suf = path.suffix.lower()
    mol = None
    try:
        if suf == ".mol2":
            mol = Chem.MolFromMol2File(str(path), sanitize=False, removeHs=False)
        elif suf in {".sdf", ".sd", ".mol"}:
            mol = Chem.MolFromMolFile(str(path), sanitize=False, removeHs=False)
    except Exception:
        return None
    if mol is None:
        return None
    orders = _bond_orders_from_mol(mol)
    return orders or None


def load_bond_orders_sidecar(pdb_path: str | Path) -> Optional[list[list[int]]]:
    """Load ``*.bonds.json`` next to a cached Maestro PDB, or derive from sibling SDF."""

    p = Path(pdb_path)
    candidate = p.with_suffix(".bonds.json")
    if not candidate.is_file():
        candidate = p.parent / f"{p.stem}.bonds.json"
    if candidate.is_file():
        try:
            data = json.loads(candidate.read_text(encoding="utf-8"))
            if isinstance(data, list) and data:
                return data
        except Exception:
            pass

    # Direct open of MOL2 / SDF / SD — orders live in the chemical file itself.
    if _is_chem_file(p):
        return _bond_orders_from_chem_path(p)

    # Fallback: ct_0000.sdf written during Maestro materialize.
    sdf = p.parent / f"{p.stem}.sdf"
    if not sdf.is_file():
        sdf = p.with_suffix(".sdf")
    if sdf.is_file():
        try:
            from rdkit import Chem

            mol = Chem.MolFromMolFile(str(sdf), sanitize=False, removeHs=False)
            if mol is not None:
                orders = _bond_orders_from_mol(mol)
                if orders:
                    try:
                        write_bond_orders_sidecar(p, orders)
                    except Exception:
                        pass
                    return orders
        except Exception:
            return None
    return None


def write_bond_orders_sidecar(pdb_path: str | Path, orders: list[list[int]]) -> Path:
    """Write ``*.bonds.json`` next to ``pdb_path``; return the sidecar path."""
    p = Path(pdb_path)
    orders_path = p.parent / f"{p.stem}.bonds.json"
    orders_path.write_text(json.dumps(orders), encoding="utf-8")
    return orders_path


# Standard residues get bond orders from the name and the atom names. A membrane
# PDB stays on this path; ligands and cofactors go through RDKit one residue at a time.
_AMINO_ACIDS = {
    "ALA", "ARG", "ASN", "ASP", "CYS", "GLN", "GLU", "GLY", "HIS", "ILE",
    "LEU", "LYS", "MET", "PHE", "PRO", "SER", "THR", "TRP", "TYR", "VAL",
    "HID", "HIE", "HIP", "HSD", "HSE", "HSP", "ASH", "GLH", "LYN", "CYX",
    "CYM", "TYM", "ARN", "MSE", "SEC", "PYL",
}
_NA_BASE = {
    "A": "A", "DA": "A", "RA": "A", "ADE": "A", "ADN": "A",
    "G": "G", "DG": "G", "RG": "G", "GUA": "G", "GAN": "G",
    "C": "C", "DC": "C", "RC": "C", "CYT": "C",
    "T": "T", "DT": "T", "THY": "T",
    "U": "U", "DU": "U", "RU": "U", "URA": "U", "URI": "U",
}
_NA_DOUBLES = {
    "A": (("N1", "C6"), ("C2", "N3"), ("C4", "C5"), ("C8", "N7")),
    "G": (("C6", "O6"), ("C2", "N3"), ("C4", "C5"), ("C8", "N7")),
    "C": (("C2", "O2"), ("N3", "C4"), ("C5", "C6")),
    "T": (("C2", "O2"), ("C4", "O4"), ("C5", "C6")),
    "U": (("C2", "O2"), ("C4", "O4"), ("C5", "C6")),
}
_SIDECHAIN_DOUBLES = {
    "ASN": (("CG", "OD1"),),
    "GLN": (("CD", "OE1"),),
    "ARG": (("CZ", "NH1"),),
    "ARN": (("CZ", "NH1"),),
    "PHE": (("CG", "CD2"), ("CD1", "CE1"), ("CE2", "CZ")),
    "TYR": (("CG", "CD2"), ("CD1", "CE1"), ("CE2", "CZ")),
    "TYM": (("CG", "CD2"), ("CD1", "CE1"), ("CE2", "CZ")),
    "TRP": (("CG", "CD1"), ("CD2", "CE3"), ("CE2", "CZ2"), ("CZ3", "CH2")),
}
_CARBOXYL = {
    "ASP": ("CG", ("OD1", "OD2")),
    "ASH": ("CG", ("OD1", "OD2")),
    "GLU": ("CD", ("OE1", "OE2")),
    "GLH": ("CD", ("OE1", "OE2")),
}
_HIS_HID = {"HID", "HSD"}
_HIS_HIE = {"HIE", "HSE", "HIS"}
_HIS_HIP = {"HIP", "HSP"}
_TEMPLATE_RESIDUES = _AMINO_ACIDS | set(_NA_BASE) | {"ACE", "NME"}
_WATER = {
    "HOH", "WAT", "H2O", "TIP", "TIP3", "TIP4", "TIP5", "T3P", "T4P", "T5P",
    "SOL", "SPC", "SPCE", "OPC",
}
_IONS = {
    "NA", "CL", "K", "MG", "ZN", "CA", "FE", "LI", "RB", "CS", "SR", "BA",
    "CU", "MN", "CO", "NI", "SOD", "CLA", "POT",
}
_TWO_LETTER_ELEMENTS = {
    "CL", "BR", "NA", "MG", "ZN", "FE", "CA", "SE", "MN", "CU", "CO", "NI",
    "SI", "LI", "AL", "AG", "AU", "HG", "PB", "SN", "BA", "SR", "CD", "CR",
    "MO", "PT", "AS", "SB",
}
_HETERO_ATOM_CAP = 300


def _atom_names(atoms) -> set[str]:
    return {str(getattr(atom, "name", "")).strip().upper() for atom in atoms}


def _proton_on(heavy: str, names: set[str]) -> bool:
    """Amber puts the hydrogen on OD2 in the name HD2."""
    if len(heavy) < 2:
        return False
    stem = "H" + heavy[1:]
    if stem in names:
        return True
    return any(name.endswith(stem) and name[0].isdigit() for name in names)


def _looks_like_hydrogen_name(name: str) -> bool:
    text = str(name).strip().upper()
    if not text:
        return False
    if text[0].isdigit():
        text = text.lstrip("0123456789")
    return text.startswith("H")


def _raw_element(atom) -> str:
    try:
        return str(getattr(atom, "element", "") or "").strip().upper()
    except Exception:
        return ""


def _residue_has_hydrogen(atoms, *, use_names: bool) -> bool:
    saw_element = False
    for atom in atoms:
        element = _raw_element(atom)
        if element in {"H", "D"}:
            return True
        if element:
            saw_element = True
            continue
        if use_names and _looks_like_hydrogen_name(getattr(atom, "name", "")):
            return True
    if saw_element:
        return False
    return any(_looks_like_hydrogen_name(getattr(atom, "name", "")) for atom in atoms)


def _element_symbol(atom) -> str:
    raw = _raw_element(atom)
    if not raw:
        letters = "".join(ch for ch in str(getattr(atom, "name", "")) if ch.isalpha()).upper()
        if len(letters) >= 2 and letters[:2] in _TWO_LETTER_ELEMENTS:
            raw = letters[:2]
        else:
            raw = letters[:1]
    if raw in {"D", "T"}:
        return "H"
    if len(raw) <= 1:
        return raw
    return raw[0] + raw[1:].lower()


def _his_pairs(resname: str, names: set[str]) -> list[tuple[str, str]]:
    if resname in _HIS_HID:
        kind = "HID"
    elif resname in _HIS_HIP:
        kind = "HIP"
    elif resname in _HIS_HIE:
        kind = "HIE"
    else:
        return []
    if resname == "HIS":
        on_nd = _proton_on("ND1", names)
        on_ne = _proton_on("NE2", names)
        if on_nd and on_ne:
            kind = "HIP"
        elif on_nd:
            kind = "HID"
    if kind == "HID":
        return [("CG", "CD2"), ("CE1", "NE2")]
    if kind == "HIP":
        return [("CG", "CD2"), ("ND1", "CE1")]
    return [("ND1", "CE1"), ("CG", "CD2")]


def _carboxyl_pairs(resname: str, names: set[str]) -> list[tuple[str, str]]:
    spec = _CARBOXYL.get(resname)
    if spec is None:
        return []
    carbon, oxygens = spec
    present = [oxygen for oxygen in oxygens if oxygen in names]
    if carbon not in names or not present:
        return []
    protonated = [oxygen for oxygen in present if _proton_on(oxygen, names)]
    if protonated:
        return [(carbon, oxygen) for oxygen in present if oxygen not in protonated]
    return [(carbon, present[0])]


def _template_pairs(resname: str, names: set[str]) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    if resname in _AMINO_ACIDS or resname == "ACE":
        if "C" in names and "O" in names:
            pairs.append(("C", "O"))
    base = _NA_BASE.get(resname)
    if base:
        pairs.extend(_NA_DOUBLES[base])
    pairs.extend(_SIDECHAIN_DOUBLES.get(resname, ()))
    pairs.extend(_his_pairs(resname, names))
    pairs.extend(_carboxyl_pairs(resname, names))
    return [(a, b) for a, b in pairs if a in names and b in names]


def _indices_by_name(atoms) -> dict[str, int]:
    found: dict[str, int] = {}
    duplicated: set[str] = set()
    for atom in atoms:
        name = str(getattr(atom, "name", "")).strip().upper()
        if not name:
            continue
        if name in found:
            duplicated.add(name)
        else:
            found[name] = int(atom.index)
    for name in duplicated:
        found.pop(name, None)
    return found


def _append_order(out: list[list[int]], seen: set[tuple[int, int]], i: int, j: int, order: int) -> None:
    if i == j or order < 2:
        return
    key = (i, j) if i < j else (j, i)
    if key in seen:
        return
    seen.add(key)
    out.append([key[0], key[1], int(order)])


def _perceive_hetero_orders(atoms) -> list[list[int]]:
    """Bond orders for one ligand or cofactor. Failure leaves that residue single."""
    atom_list = list(atoms)
    if len(atom_list) < 2 or len(atom_list) > _HETERO_ATOM_CAP:
        return []
    try:
        from rdkit import Chem
        from rdkit.Chem import rdDetermineBonds
        from rdkit.Geometry import Point3D
    except Exception:
        return []

    table = Chem.GetPeriodicTable()
    rw = Chem.RWMol()
    index_map: list[int] = []
    for atom in atom_list:
        symbol = _element_symbol(atom)
        try:
            atomic_number = int(table.GetAtomicNumber(symbol))
        except Exception:
            return []
        if atomic_number <= 0:
            return []
        rw.AddAtom(Chem.Atom(atomic_number))
        index_map.append(int(atom.index))
    mol = rw.GetMol()
    conformer = Chem.Conformer(len(index_map))
    try:
        for i, atom in enumerate(atom_list):
            pos = atom.position
            conformer.SetAtomPosition(
                i, Point3D(float(pos[0]), float(pos[1]), float(pos[2]))
            )
    except Exception:
        return []
    mol.AddConformer(conformer, assignId=True)

    for charge in (0, -1, 1, -2, 2):
        trial = Chem.Mol(mol)
        try:
            rdDetermineBonds.DetermineConnectivity(trial)
            rdDetermineBonds.DetermineBondOrders(trial, charge=charge)
        except Exception:
            continue
        try:
            Chem.Kekulize(trial)
        except Exception:
            pass
        raw = _bond_orders_from_mol(trial)
        mapped = [
            [index_map[i], index_map[j], order]
            for i, j, order in raw
            if order >= 2 and i < len(index_map) and j < len(index_map)
        ]
        if mapped:
            return mapped
    return []


def perceive_bond_orders(residues) -> list[list[int]]:
    """Double and triple bonds for a hydrogen-containing structure with no topology.

    Protein, nucleic acid, and water orders come from the residue name. Every
    other residue is one RDKit molecule. A residue with no hydrogen, or one
    RDKit cannot perceive, contributes nothing and stays a single bond.
    """
    out: list[list[int]] = []
    seen: set[tuple[int, int]] = set()
    for residue in residues:
        resname = str(getattr(residue, "resname", "")).strip().upper()
        atoms = list(getattr(residue, "atoms", ()) or ())
        if not atoms or resname in _WATER or resname in _IONS:
            continue
        if resname in _TEMPLATE_RESIDUES:
            if not _residue_has_hydrogen(atoms, use_names=True):
                continue
            names = _atom_names(atoms)
            by_name = _indices_by_name(atoms)
            for left, right in _template_pairs(resname, names):
                i = by_name.get(left)
                j = by_name.get(right)
                if i is None or j is None:
                    continue
                _append_order(out, seen, i, j, 2)
            continue
        if not _residue_has_hydrogen(atoms, use_names=False):
            continue
        for row in _perceive_hetero_orders(atoms):
            _append_order(out, seen, int(row[0]), int(row[1]), int(row[2]))
    return out


def _sidecar_is_fresh(pdb_path: Path) -> bool:
    sidecar = pdb_path.parent / f"{pdb_path.stem}.bonds.json"
    try:
        return sidecar.is_file() and sidecar.stat().st_mtime >= pdb_path.stat().st_mtime
    except OSError:
        return False


def _restrict_orders_to_bonds(orders: list[list[int]], bonds: list | None) -> list[list[int]]:
    """Keep perceived orders that sit on the connectivity already drawn."""
    if bonds is None:
        return orders
    keys: set[tuple[int, int]] = set()
    for row in bonds:
        if not isinstance(row, (list, tuple)) or len(row) < 2:
            continue
        i, j = int(row[0]), int(row[1])
        keys.add((i, j) if i <= j else (j, i))
    kept: list[list[int]] = []
    for row in orders:
        i, j = int(row[0]), int(row[1])
        key = (i, j) if i <= j else (j, i)
        if key in keys:
            kept.append([i, j, int(row[2]) if len(row) > 2 else 1])
    return kept


def resolve_viewer_bond_orders(
    pdb_path: str | Path,
    universe: Any | None,
    topology_used: str | None,
    bonds: list | None = None,
) -> Optional[list[list[int]]]:
    """Sidecar orders for Visualize, perceiving a bare PDB when the cache is stale.

    A topology already supplies connectivity, so this does not invent orders for
    it. ``name.bonds.json`` is rewritten when the PDB is newer than the cache.
    Perception never writes ``CONECT`` back into the PDB.
    """
    path = Path(pdb_path)
    if _sidecar_is_fresh(path):
        return load_bond_orders_sidecar(path)
    if topology_used or universe is None:
        return load_bond_orders_sidecar(path)
    if bonds is not None and len(bonds) == 0:
        return None
    try:
        orders = perceive_bond_orders(getattr(universe, "residues", ()) or ())
        orders = _restrict_orders_to_bonds(orders, bonds)
    except Exception:
        return load_bond_orders_sidecar(path)
    if not orders:
        return None
    try:
        write_bond_orders_sidecar(path, orders)
    except Exception:
        pass
    return orders


def _materialize_maestro_rdkit(
    path: Path,
    indices: list[int],
    out_dir: Path,
    entries: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    from rdkit import Chem

    mae_path = _open_mae_text_path(path)
    cleanup = mae_path != path
    want = set(indices)
    structures: list[dict[str, Any]] = []
    try:
        supplier = Chem.MaeMolSupplier(str(mae_path), sanitize=False, removeHs=False)
        for i, mol in enumerate(supplier):
            if i not in want:
                continue
            if mol is None:
                raise RuntimeError(f"CT {i} failed to parse")
            out_path = out_dir / f"ct_{i:04d}.pdb"
            sdf_path = out_dir / f"ct_{i:04d}.sdf"
            if not out_path.is_file() or out_path.stat().st_size == 0:
                block = Chem.MolToPDBBlock(mol)
                if not block or not block.strip():
                    raise RuntimeError(f"CT {i}: empty PDB block from RDKit")
                out_path.write_text(block, encoding="utf-8")
            if not sdf_path.is_file() or sdf_path.stat().st_size == 0:
                try:
                    Chem.MolToMolFile(mol, str(sdf_path))
                except Exception:
                    pass
            else:
                # Refresh SDF when regenerating bond orders for an existing cache entry.
                try:
                    Chem.MolToMolFile(mol, str(sdf_path))
                except Exception:
                    pass
            bond_orders = _bond_orders_from_mol(mol)
            orders_path = write_bond_orders_sidecar(out_path, bond_orders)
            meta = next((e for e in entries if e.get("index") == i), None) or (
                entries[i] if i < len(entries) else {}
            )
            structures.append(
                {
                    "sourcePath": str(path),
                    "kind": "maestro_ct",
                    "label": meta.get("label") or _entry_label(path, "maestro_ct", i),
                    "path": str(out_path),
                    "pdbPath": str(out_path),
                    "ctIndex": i,
                    "modelIndex": None,
                    "bondOrdersPath": str(orders_path),
                    "properties": _maestro_ct_properties(mol),
                }
            )
        if len(structures) != len(want):
            missing = want - {s["ctIndex"] for s in structures}
            raise RuntimeError(f"Missing CT indices: {sorted(missing)}")
        return structures
    finally:
        if cleanup:
            try:
                mae_path.unlink(missing_ok=True)
            except OSError:
                pass


def _materialize_maestro_openbabel(
    path: Path,
    indices: list[int],
    out_dir: Path,
    entries: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    obabel = shutil.which("obabel") or shutil.which("obabel.exe")
    if not obabel:
        raise RuntimeError("obabel not found on PATH")
    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        # Write each molecule as separate PDB: obabel -m
        pattern = td_path / "mol.pdb"
        cmd = [obabel, str(path), "-O", str(pattern), "-m"]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.strip() or "obabel -m failed")
        # Best-effort SDF with bond orders for the sidecar.
        sdf_pattern = td_path / "mol.sdf"
        subprocess.run(
            [obabel, str(path), "-O", str(sdf_pattern), "-m"],
            capture_output=True,
            text=True,
            timeout=300,
        )
        # obabel names: mol1.pdb, mol2.pdb, ...
        produced = sorted(td_path.glob("mol*.pdb"), key=lambda q: q.name)
        sdf_produced = sorted(td_path.glob("mol*.sdf"), key=lambda q: q.name)
        if not produced:
            raise RuntimeError("obabel produced no PDB files")
        structures: list[dict[str, Any]] = []
        for i in indices:
            if i >= len(produced):
                raise ValueError(f"CT index {i} out of range ({len(produced)} molecules)")
            src = produced[i]
            out_path = out_dir / f"ct_{i:04d}.pdb"
            if not out_path.is_file() or out_path.stat().st_size == 0:
                shutil.copy2(src, out_path)
            orders_path = None
            if i < len(sdf_produced):
                try:
                    from rdkit import Chem

                    mol = Chem.MolFromMolFile(str(sdf_produced[i]), sanitize=False, removeHs=False)
                    if mol is not None:
                        orders_path = write_bond_orders_sidecar(
                            out_path, _bond_orders_from_mol(mol)
                        )
                except Exception:
                    orders_path = None
            meta = next((e for e in entries if e.get("index") == i), None) or (
                entries[i] if i < len(entries) else {}
            )
            entry = {
                "sourcePath": str(path),
                "kind": "maestro_ct",
                "label": meta.get("label") or _entry_label(path, "maestro_ct", i),
                "path": str(out_path),
                "pdbPath": str(out_path),
                "ctIndex": i,
                "modelIndex": None,
                "properties": [],
            }
            if orders_path is not None:
                entry["bondOrdersPath"] = str(orders_path)
            structures.append(entry)
        return structures
