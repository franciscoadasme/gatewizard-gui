"""Write an mmCIF file as PDB, including hybrid-36 serials past 99,999 atoms.

MDAnalysis in the GUI environment reads PDB (and hybrid-36 serials) but not
mmCIF. RCSB entries such as 5GOA are published only as mmCIF because they
have more than 99,999 atoms, which classic PDB decimal serials cannot store.
"""

from __future__ import annotations

from pathlib import Path

from Bio.PDB.MMCIFParser import MMCIFParser
from Bio.PDB.PDBExceptions import PDBConstructionException

_DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


class StructureConvertError(Exception):
    """The mmCIF file could not be written as a PDB the viewer can open."""


def hy36encode(width: int, number: int) -> str:
    """Encode ``number`` in ``width`` columns, using hybrid-36 past 10**width-1.

    Matches MDAnalysis ``hy36decode``: 99999 stays decimal, 100000 is ``A0000``.
    """
    if width < 1:
        raise StructureConvertError(f"Invalid hybrid-36 width {width}")
    if number < 0:
        text = f"{number:d}"
        if len(text) > width:
            raise StructureConvertError(
                f"Residue number {number} does not fit in {width} PDB columns"
            )
        return f"{number:{width}d}"
    limit = 10**width
    if number < limit:
        return f"{number:{width}d}"
    offset = number - limit + 10 * 36 ** (width - 1)
    chars: list[str] = []
    remaining = offset
    for _ in range(width):
        remaining, rem = divmod(remaining, 36)
        chars.append(_DIGITS[rem])
    if remaining:
        raise StructureConvertError(
            f"Number {number} does not fit in hybrid-36 width {width}"
        )
    encoded = "".join(reversed(chars))
    if not encoded[:1].isalpha() or not encoded[:1].isupper():
        raise StructureConvertError(f"Could not encode {number} as hybrid-36")
    return encoded


def mda_topology_format(path: Path) -> str | None:
    """Format flag for a PDB this module wrote.

    MDAnalysis's normal PDB parser adds 10,000 to a residue number whenever
    it drops by more than 5,000 from the previous atom. A new chain that
    restarts at 1 after a long chain (5GOA chains run to 4964) is renumbered.
    The extended parser reads the same columns and keeps the author numbers.
    """
    if Path(path).suffix.lower() != ".pdb":
        return None
    try:
        with Path(path).open("r", encoding="utf-8", errors="replace") as handle:
            first = handle.readline()
    except OSError:
        return None
    if "CONVERTED FROM MMCIF" in first:
        return "XPDB"
    return None


def pdb_from_mmcif(cif_path: Path) -> Path:
    """Return a PDB next to ``cif_path``, rewriting it when the mmCIF is newer."""
    cif_path = Path(cif_path)
    if not cif_path.is_file():
        raise StructureConvertError(f"mmCIF file not found: {cif_path}")
    dest = cif_path.with_suffix(".pdb")
    src_mtime = cif_path.stat().st_mtime
    if dest.is_file() and dest.stat().st_size > 0 and dest.stat().st_mtime >= src_mtime:
        return dest
    partial = dest.with_name(dest.name + ".writing")
    try:
        _write_mmcif_as_pdb(cif_path, partial)
        partial.replace(dest)
    except (OSError, ValueError, PDBConstructionException) as ex:
        partial.unlink(missing_ok=True)
        if isinstance(ex, StructureConvertError):
            raise
        raise StructureConvertError(str(ex)) from ex
    except StructureConvertError:
        partial.unlink(missing_ok=True)
        raise
    return dest


def _write_mmcif_as_pdb(cif_path: Path, dest: Path) -> None:
    parser = MMCIFParser(QUIET=True)
    structure = parser.get_structure(cif_path.stem, str(cif_path))
    models = list(structure.get_models())
    if not models:
        raise StructureConvertError(f"No models in {cif_path.name}")
    multi = len(models) > 1
    written = 0
    with dest.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(f"HEADER    CONVERTED FROM MMCIF{cif_path.stem.upper():>49}\n")
        for model_index, model in enumerate(models, start=1):
            if multi:
                handle.write(f"MODEL     {model_index:4d}\n")
            serial = 1
            for chain in model:
                chain_id = _chain_column(str(chain.id))
                for residue in chain:
                    resseq = int(residue.id[1])
                    icode = _one_char(residue.id[2], " ")
                    resname = f"{str(residue.resname).strip()[:3]:>3}"
                    record = "ATOM  " if residue.id[0] == " " else "HETATM"
                    for atom in residue:
                        handle.write(
                            _atom_line(
                                record,
                                serial,
                                _atom_name(atom),
                                _one_char(getattr(atom, "altloc", " "), " "),
                                resname,
                                chain_id,
                                resseq,
                                icode,
                                float(atom.coord[0]),
                                float(atom.coord[1]),
                                float(atom.coord[2]),
                                _float_or(getattr(atom, "occupancy", None), 1.0),
                                _float_or(getattr(atom, "bfactor", None), 0.0),
                                _element(atom),
                            )
                        )
                        serial += 1
                        written += 1
            if multi:
                handle.write("ENDMDL\n")
        handle.write("END\n")
    if written == 0:
        raise StructureConvertError(f"No atoms in {cif_path.name}")


def _atom_line(
    record: str,
    serial: int,
    name: str,
    alt: str,
    resname: str,
    chain: str,
    resseq: int,
    icode: str,
    x: float,
    y: float,
    z: float,
    occ: float,
    bfactor: float,
    element: str,
) -> str:
    return (
        f"{record}{hy36encode(5, serial)} {name}{alt}{resname} {chain}"
        f"{hy36encode(4, resseq)}{icode}   {x:8.3f}{y:8.3f}{z:8.3f}"
        f"{occ:6.2f}{bfactor:6.2f}      {'':4}{element}  \n"
    )


def _chain_column(chain_id: str) -> str:
    text = chain_id.strip()
    if not text:
        return " "
    if len(text) == 1:
        return text
    # The PDB chain column is one character. Keep that character; longer
    # author ids cannot be stored without changing how chains are resolved.
    return text[0]


def _one_char(value, default: str) -> str:
    text = str(value or "")
    if not text or text in {".", "?"}:
        return default
    return text[0]


def _atom_name(atom) -> str:
    element = str(getattr(atom, "element", "") or "").strip()
    raw = str(getattr(atom, "fullname", None) or atom.get_name() or "").strip()
    if len(raw) < 4 and raw[:1].isalpha() and len(element) < 2:
        raw = " " + raw
    return f"{raw:<4}"[:4]


def _element(atom) -> str:
    element = str(getattr(atom, "element", "") or "").strip().upper()
    if not element or len(element) > 2:
        return "  "
    return f"{element:>2}"


def _float_or(value, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default
