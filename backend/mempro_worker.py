"""Standalone MemPro worker — invoked as a detached subprocess.

Reads a state JSON file (written by app.py), runs MemPro, then writes
results back to the same file so the result survives even if the backend
(and the Electron GUI) have been closed and reopened.

Usage:
    python mempro_worker.py <state_file_path>
"""

import json
import os
import sys


def _write_state(state_file: str, data: dict) -> None:
    tmp = state_file + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f)
    os.replace(tmp, state_file)


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit("Usage: mempro_worker.py <state_file>")

    state_file = sys.argv[1]

    try:
        with open(state_file) as f:
            state = json.load(f)
    except Exception as exc:
        sys.exit(f"Cannot read state file: {exc}")

    try:
        from gatewizard.core.mempro import MemPrO  # type: ignore[import]

        mp = MemPrO()
        p = state.get("params", {})
        results = mp.run(
            p["path"],
            n_cpus=p.get("n_cpus"),
            n_iters=p.get("n_iters", 150),
            grid_size=p.get("grid_size", 36),
            dual_membrane=p.get("dual_membrane", False),
            peripheral=p.get("peripheral", False),
            use_weights=p.get("use_weights", False),
            flip=p.get("flip", False),
            membrane_thickness=p.get("membrane_thickness"),
            seed=p.get("seed"),
            device=p.get("device"),
            single_precision=p.get("single_precision", False),
            rank=p.get("rank"),
            predict_pg=p.get("predict_pg", False),
            pg_guess=p.get("pg_guess"),
            charge=p.get("charge"),
            charge_outer=p.get("charge_outer"),
            outer_membrane_thickness=p.get("outer_membrane_thickness"),
            optimize_thickness=p.get("optimize_thickness", False),
            transmembrane_residues=p.get("transmembrane_residues"),
            write_bfactors=p.get("write_bfactors", False),
            curvature=p.get("curvature", False),
            itp_file=p.get("itp_file"),
            insane_path=p.get("insane_path"),
            build_system=p.get("build_system"),
            build_arguments=p.get("build_arguments"),
            additional_residues=p.get("additional_residues"),
            additional_residues_itp=p.get("additional_residues_itp"),
            residue_cg_file=p.get("residue_cg_file"),
        )
        state["status"] = "done"
        state["results"] = [
            {
                "rank": r.rank,
                "relative_potential": r.relative_potential,
                "hits_pct": r.hits_pct,
                "rerank_potential": r.rerank_potential,
                "rerank_depth": r.rerank_depth,
                "rerank_value": r.rerank_value,
                "pdb_path": r.pdb_path,
            }
            for r in results
        ]
        state["error"] = None
    except Exception as exc:  # noqa: BLE001
        state["status"] = "error"
        state["error"] = str(exc)

    _write_state(state_file, state)


if __name__ == "__main__":
    main()
