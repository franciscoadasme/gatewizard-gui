# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.7] - 2026-07-03

### Added

- **Builder:** Add packmol-memgen `--dist` as “Boundary distance” with default `12 Å`

### Fixed

- **Linux / WSL runtime startup:** Persist dependency cache state after requirements updates so MemPrO and OpenMM checks do not repeat on every launch

### Changed

- **Builder:** Default water layer thickness (`--dist_wat`) is now `26 Å`
- Requires gatewizard API **1.0.44**

## [1.0.6] - 2026-07-01

### Added

- **Light / dark theme:** Sun/moon toggle in the activity sidebar; preference persists across restarts; title bar and taskbar icons follow the theme
- **Visualize — 3D scene settings:** Viewport background follows app theme by default; sun button on the Representations toolbar opens a panel for background color, lighting, Goodsell outlines, and reset (saved in `gw_viewer_settings`)
- **Visualize — Goodsell material:** David Goodsell–style preset (cartoon, tube, ball-and-stick, vdW) with per-view outline and flat-lighting options
- **Visualize — Glowing material:** Emissive preset for highlighting regions in the 3D view
- **GitHub:** Issue templates and community docs for bug reports and feature requests

### Fixed

- **Visualize — secondary structure (CHARMM/NAMD):** Align atom/residue chain IDs in `/get-structure` with gatewizard SS assignment (`resolve_pdb_chain_id` for long segids like `PROT`), so cartoon/tube coloring works when PSIQUE fails or falls back
- **Visualize — Glowing material:** Fix freezes and WebGL bulb shader overflow on some GPUs
- **Dev — CSP:** Allow Vite dev server and Threlte WebAssembly in the renderer content security policy
- **macOS runtime — broken SSL / pip:** Detect corrupted OpenSSL, repair or wipe `mamba-env` and reinstall; migration no longer rewrites binary `.dylib` files as text

### Changed

- **Splash:** Placeholder circle logo with “GateWizard” label inside the hex; key-flip animation removed; spark progress border kept while the brand is being redesigned
- **Branding:** Temporary circle logos for title bar, taskbar, installer, and README header
- **Releases:** Linux (AppImage + `.deb`) and macOS (`.dmg`) only — **no native Windows `.exe`**; Windows users install via **WSL**
- **README:** Windows/WSL install guidance; native Windows marked unsupported
- Requires gatewizard API **1.0.43** (library-only package; no `gatewizard` console command)

## [1.0.5] - 2026-06-19

### Fixed

- **Visualize — MemPro Apply:** Applies the MemPro rigid-body orientation to the loaded structure, keeping ligands, water, and other molecules instead of replacing the view with MemPro output only
- **Equilibration — Generate Input Files (NAMD):** Input generation no longer requires NAMD to be installed on PATH; the executable name is written into the run script and only needed when you run equilibration. GROMACS still requires `gmx` during setup (index/posres generation).
- **Visualize — secondary structure:** Cartoon/tube/SS coloring uses the API assignment chain (PSIQUE first, then PDB records, then CA-angle heuristic) instead of calling PSIQUE only in the backend, so SS still renders when PSIQUE is unavailable (e.g. Windows)
- **Builder — input-files warning:** The yellow “Input files have not been generated yet” banner no longer reappears after Start Preparation once inputs have been generated
- Windows `.exe`, installer, and shortcuts use the GateWizard logo (`afterPack` applies the icon via `resedit`, avoiding winCodeSign symlink issues on Windows).
- NAMD and GROMACS are detected when opening the app from the desktop or Start menu, not only from a terminal.
- **macOS — PDB download (Visualize):** Downloading a structure by PDB ID failed with HTTP 500 because the backend tried to save files in a read-only working directory in packaged apps; downloads now use a writable app data directory (`GATEWIZARD_USER_DATA`).
- **macOS — Prepare (Preparation):** Clicking Prepare failed with HTTP 500 when writing the protonated PDB or running `pdb4amber`; output paths are validated, errors are reported clearly, `CONDA_PREFIX` is passed to the backend, and protonated files are saved to the working directory when one is set.
- **macOS — conda runtime path:** Move micromamba env from `Application Support` (spaces in path break `pdb4amber` shebangs) to `~/Library/gatewizard-gui`; existing installs are migrated on next launch and stale interpreter paths in the env are rewritten.

### Changed

- Requires gatewizard API **1.0.40** (MemPro full-structure apply, SS fallback, macOS tleap/PropKa/pdb4amber fixes).

## [1.0.4] - 2026-06-08

### Added

- Cross-platform release workflow (Linux AppImage/deb, Windows installer, macOS dmg).
- In-app update check and dependency versions UI.

### Changed

- Platform-specific executable names (`gatewizard-gui-linux`, `gatewizard-gui-win`, `gatewizard-gui-mac`).
