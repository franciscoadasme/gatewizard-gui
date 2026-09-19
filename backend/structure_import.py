"""Inspect and materialize multi-entry structure sources for Visualize.

Supports:
- Maestro ``.mae`` / ``.maegz`` (RDKit MaeMolSupplier; Open Babel fallback)
- Multi-MODEL PDB (``MODEL`` / ``ENDMDL``)
- Single-file pass-through (PDB/CIF/…)

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


def _count_pdb_models(path: Path) -> int:
    """Count MODEL records; 0 means a single implicit model (no MODEL keywords)."""
    n = 0
    with path.open("r", encoding="utf-8", errors="replace") as f:
        for line in f:
            if line.startswith("MODEL"):
                n += 1
    return n


def _entry_label(source: Path, kind: str, index: int, title: str | None = None) -> str:
    base = source.name
    if title and title.strip():
        return f"{base} · {title.strip()}"
    if kind == "maestro_ct":
        return f"{base} · CT {index + 1}"
    if kind == "pdb_model":
        return f"{base} · model {index + 1}"
    return base


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


def _inspect_maestro(path: Path) -> list[dict[str, Any]]:
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
            meta = entries[i] if i < len(entries) else {}
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
            meta = entries[i] if i < len(entries) else {}
            entry = {
                "sourcePath": str(path),
                "kind": "maestro_ct",
                "label": meta.get("label") or _entry_label(path, "maestro_ct", i),
                "path": str(out_path),
                "pdbPath": str(out_path),
                "ctIndex": i,
                "modelIndex": None,
            }
            if orders_path is not None:
                entry["bondOrdersPath"] = str(orders_path)
            structures.append(entry)
        return structures
