"""Write an mmCIF file as PDB, including hybrid-36 serials past 99,999 atoms.

MDAnalysis in the GUI environment reads PDB (and hybrid-36 serials) but not
mmCIF. RCSB entries such as 5GOA are published only as mmCIF because they
have more than 99,999 atoms, which classic PDB decimal serials cannot store.
"""

from __future__ import annotations

import re
import tempfile
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


def pdb_for_reader(path: Path) -> Path:
    """Coordinate PDB for :func:`pdb_reader_sources`."""
    coordinates, _topology = pdb_reader_sources(path)
    return coordinates


def pdb_reader_sources(path: Path) -> tuple[Path, Path | None]:
    """Return ``(coordinates, topology)`` for MDAnalysis.

    A normal PDB is ``(path, None)``. Amber and packmol write decimal serials
    past 99,999 and residue numbers past 9,999 in the PDB columns, so a
    coordinate field becomes text such as ``6 104.47``. A negative coordinate
    can also sit flush against the previous number (``46.591-107.358``).
    Those files are rewritten to aligned coordinates plus a PSF that keeps
    the real residue numbers. The earlier hybrid-36 writer only covered
    mmCIF downloads.
    """
    source = Path(path)
    if source.suffix.lower() != ".pdb" or not source.is_file():
        return source, None
    if not _pdb_coord_columns_overflow(source):
        return source, None
    stamp = source.stat()
    folder = Path(tempfile.gettempdir()) / "gatewizard-pdb"
    stem = f"{source.stem}-{stamp.st_mtime_ns}-{stamp.st_size}"
    coordinates = folder / f"{stem}.pdb"
    topology = folder / f"{stem}.psf"
    if (
        coordinates.is_file()
        and topology.is_file()
        and coordinates.stat().st_size > 0
        and topology.stat().st_size > 0
    ):
        return coordinates, topology
    folder.mkdir(parents=True, exist_ok=True)
    partial_pdb = coordinates.with_name(coordinates.name + ".writing")
    partial_psf = topology.with_name(topology.name + ".writing")
    try:
        _rewrite_overflow_pdb(source, partial_pdb, partial_psf)
        partial_pdb.replace(coordinates)
        partial_psf.replace(topology)
    except Exception:
        partial_pdb.unlink(missing_ok=True)
        partial_psf.unlink(missing_ok=True)
        raise
    return coordinates, topology


def _pdb_coord_columns_overflow(path: Path) -> bool:
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            if not line.startswith(("ATOM", "HETATM")) or len(line) < 54:
                continue
            try:
                float(line[30:38])
                float(line[38:46])
                float(line[46:54])
            except ValueError:
                return True
            # Columns 7–11 are the serial. A 5-digit serial on HETATM has no
            # space after the record name, so split() sees the atom name
            # ("K") instead of the serial. That line is still a normal PDB.
            serial = line[6:11]
            if serial.strip().isdigit() and not (len(line) > 11 and line[11].isdigit()):
                continue
            parts = line.split()
            if len(parts) < 2 or not parts[1].isdigit():
                return True
    return False


def _rewrite_overflow_pdb(source: Path, dest: Path, psf_dest: Path) -> None:
    atoms: list[tuple] = []
    with source.open("r", encoding="utf-8", errors="replace") as handle, dest.open(
        "w", encoding="utf-8", newline="\n"
    ) as out:
        for line in handle:
            if line.startswith(("ATOM", "HETATM")):
                parsed = _parse_overflow_atom(line)
                atoms.append(parsed)
                out.write(_repaired_atom_line(parsed))
            elif line.startswith("CONECT"):
                continue
            else:
                out.write(line if line.endswith("\n") else line + "\n")
    with psf_dest.open("w", encoding="utf-8", newline="\n") as psf:
        psf.write("PSF NAMD\n\n")
        psf.write("       1 !NTITLE\n")
        psf.write(" REMARKS gatewizard column repair\n\n")
        psf.write(f"{len(atoms):8d} !NATOM\n")
        for index, parsed in enumerate(atoms, start=1):
            _serial, raw_name, resseq, resname, chain = parsed[:5]
            segid = chain.strip() or "A"
            atom = raw_name.strip() or "X"
            residue = resname.strip() or "UNK"
            psf.write(
                f"{index:8d} {segid} {resseq} {residue} {atom} {atom} 0.0 1.0\n"
            )
        psf.write("\n       0 !NBOND\n")


def _parse_overflow_atom(
    line: str,
) -> tuple[int, str, int, str, str, str, str, float, float, float, float, float]:
    parts = line.split()
    record = "ATOM  " if line.startswith("ATOM") else "HETATM"
    serial, glued_name = _split_serial_and_name(parts[1])
    if glued_name is None:
        raw_name = parts[2]
        fields = parts[3:]
    else:
        raw_name = glued_name
        fields = parts[2:]
    resname = f"{fields[0][:3]:>3}"
    index = 1
    chain = " "
    token = fields[index]
    if not _signed_int(token):
        chain = token[:1] or " "
        index += 1
        token = fields[index]
    resseq = int(token)
    index += 1
    numbers: list[str] = []
    for token in fields[index:]:
        numbers.extend(_split_glued_numbers(token))
    if len(numbers) < 3:
        raise ValueError(f"could not read coordinates from {line[:80]!r}")
    x, y, z = (float(numbers[0]), float(numbers[1]), float(numbers[2]))
    occ = float(numbers[3]) if len(numbers) > 3 else 1.0
    bfactor = float(numbers[4]) if len(numbers) > 4 else 0.0
    return (
        serial,
        raw_name,
        resseq,
        resname,
        chain,
        record,
        _pdb_atom_name(raw_name),
        x,
        y,
        z,
        occ,
        bfactor,
    )


def _repaired_atom_line(
    parsed: tuple[int, str, int, str, str, str, str, float, float, float, float, float],
) -> str:
    serial, raw_name, resseq, resname, chain, record, name, x, y, z, occ, bfactor = parsed
    stored_resseq = resseq if resseq <= 9999 else 1
    return _atom_line(
        record,
        serial,
        name,
        " ",
        resname,
        chain,
        stored_resseq,
        " ",
        x,
        y,
        z,
        occ,
        bfactor,
        _element_from_name(raw_name),
    )


def _pdb_atom_name(name: str) -> str:
    text = name.strip()
    if len(text) >= 4:
        return text[:4]
    if len(text) == 1 or (len(text) <= 3 and text[:1].isalpha() and text[1:2].isdigit()):
        return f" {text:<3}"[:4]
    return f"{text:<4}"[:4]


def _element_from_name(name: str) -> str:
    letters = "".join(char for char in name if char.isalpha()).upper()
    if len(letters) >= 2 and letters[:2] in {
        "BR",
        "CA",
        "CL",
        "FE",
        "MG",
        "NA",
        "ZN",
    }:
        return f"{letters[:2]:>2}"
    if letters:
        return f"{letters[0]:>2}"
    return "  "


_NUMERIC_TOKEN = re.compile(r"[-+]?(?:\d+\.\d+|\.\d+|\d+)")


def _split_serial_and_name(token: str) -> tuple[int, str | None]:
    """Split ``100044C110`` into serial 100044 and atom name C110.

    A serial past 99,999 is wider than the five PDB columns, so it overwrites
    the blank before the atom name and ``split`` returns one token.
    """
    if token.isdigit():
        return int(token), None
    for size in range(min(4, len(token) - 1), 0, -1):
        serial_text, name = token[:-size], token[-size:]
        if (
            serial_text.isdigit()
            and len(serial_text) >= 5
            and _looks_like_atom_name(name)
        ):
            return int(serial_text), name
    raise ValueError(f"could not read atom serial from {token!r}")


def _looks_like_atom_name(name: str) -> bool:
    if not 1 <= len(name) <= 4:
        return False
    if name[0].isalpha():
        return True
    # Hydrogen names such as 1HG. "1Cl-" is the spilled end of a serial.
    return len(name) >= 2 and name[0] in "123456789" and name[1] == "H"


def _split_glued_numbers(token: str) -> list[str]:
    """Split a coordinate token that contains two numbers.

    ``%8.3f`` writes ``-107.358`` in all eight columns, so the previous
    field is not followed by a space: ``46.591-107.358``.
    """
    pieces = _NUMERIC_TOKEN.findall(token)
    if len(pieces) > 1 and "".join(pieces) == token:
        return pieces
    return [token]


def _signed_int(token: str) -> bool:
    text = token[1:] if token[:1] in "+-" else token
    return text.isdigit()


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


def is_mmcif_file(path: Path) -> bool:
    """True for ``.cif`` / ``.mmcif``, or a file whose text starts with ``data_``.

    Save PDB used to copy an assembly mmCIF onto a ``.pdb`` path. That file
    still begins with a data block, so readers can recognize it.
    """
    file_path = Path(path)
    if file_path.suffix.lower() in {".cif", ".mmcif"}:
        return True
    try:
        with file_path.open("r", encoding="utf-8", errors="replace") as handle:
            for _ in range(20):
                line = handle.readline()
                if not line:
                    return False
                stripped = line.strip()
                if not stripped or stripped.startswith("#"):
                    continue
                return stripped.lower().startswith("data_")
    except OSError:
        return False
    return False


def pdb_from_mmcif(cif_path: Path, dest: Path | None = None) -> Path:
    """Return a PDB next to ``cif_path``, rewriting it when the mmCIF is newer.

    Pass ``dest`` to write a specific ``.pdb`` path. That is how Save PDB turns
    an assembly mmCIF into a file MDAnalysis can open again.
    """
    cif_path = Path(cif_path)
    if not cif_path.is_file():
        raise StructureConvertError(f"mmCIF file not found: {cif_path}")
    if dest is None:
        dest = cif_path.with_suffix(".pdb")
        if dest.resolve() == cif_path.resolve():
            dest = cif_path.with_name(f"{cif_path.stem}_from_mmcif.pdb")
        src_mtime = cif_path.stat().st_mtime
        if dest.is_file() and dest.stat().st_size > 0 and dest.stat().st_mtime >= src_mtime:
            return dest
    else:
        dest = Path(dest)
        if dest.resolve() == cif_path.resolve():
            raise StructureConvertError(
                "Cannot replace an mmCIF file in place; choose a .pdb path."
            )
    dest.parent.mkdir(parents=True, exist_ok=True)
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


def write_universe_pdb(universe, dest: Path) -> None:
    """Write ``universe`` as a hybrid-36 PDB.

    Chain ids longer than one character are stored as their first letter.
    Every atom is written, including assemblies past the 99,999 serial limit.
    """
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    partial = dest.with_name(dest.name + ".writing")
    atoms = universe.atoms
    try:
        with partial.open("w", encoding="utf-8", newline="\n") as handle:
            handle.write(f"HEADER    CONVERTED FROM MMCIF{'':>49}\n")
            for serial, atom in enumerate(atoms, start=1):
                chain = str(getattr(atom, "chainID", "") or " ").strip() or " "
                raw = str(atom.name).strip()
                if len(raw) < 4:
                    raw = " " + raw
                element = str(getattr(atom, "element", "") or "").strip().upper()
                handle.write(
                    _atom_line(
                        "ATOM  ",
                        serial,
                        f"{raw:<4}"[:4],
                        " ",
                        f"{str(atom.resname).strip()[:3]:>3}",
                        chain[0],
                        int(atom.resid),
                        " ",
                        float(atom.position[0]),
                        float(atom.position[1]),
                        float(atom.position[2]),
                        1.0,
                        0.0,
                        f"{element:>2}"[:2] if element else "  ",
                    )
                )
            handle.write("END\n")
        partial.replace(dest)
    except Exception:
        partial.unlink(missing_ok=True)
        raise


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
                        for alt_atom in _disordered_atoms(atom):
                            handle.write(
                                _atom_line(
                                    record,
                                    serial,
                                    _atom_name(alt_atom),
                                    _one_char(getattr(alt_atom, "altloc", " "), " "),
                                    resname,
                                    chain_id,
                                    resseq,
                                    icode,
                                    float(alt_atom.coord[0]),
                                    float(alt_atom.coord[1]),
                                    float(alt_atom.coord[2]),
                                    _float_or(getattr(alt_atom, "occupancy", None), 1.0),
                                    _float_or(getattr(alt_atom, "bfactor", None), 0.0),
                                    _element(alt_atom),
                                )
                            )
                            serial += 1
                            written += 1
            if multi:
                handle.write("ENDMDL\n")
        handle.write("END\n")
    if written == 0:
        raise StructureConvertError(f"No atoms in {cif_path.name}")


def _disordered_atoms(atom):
    """Every altLoc of one atom. A single conformation is returned as itself."""
    try:
        if atom.is_disordered():
            children = list(atom.disordered_get_list())
            if children:
                return children
    except Exception:
        pass
    return [atom]


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
