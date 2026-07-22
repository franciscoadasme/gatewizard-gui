# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.12] - 2026-07-22

### Added

- **Equilibration:** discover runs under the working directory (engine, variant, ensemble); watch multiple jobs with compact stage bars; **Run** and **Continue** on job cards (stage-level resume via `POST /continue-equilibration`); per-job simulated ns total and CPU/GPU resource summary; **Use in form** restores output folder, engine, input directory, ensemble, and protocol; per-card **Reload** (`POST /equilibration-job-summary`) after manual JSON edits; per-output-folder generate/run locking while MD runs elsewhere
- **UI:** bundled Roboto (SIL OFL) for renderer and splash so type matches across Windows / macOS / Linux; charts, axes gizmo, and transform gizmo use the same face
- **UI:** shared `gw-notice` / `gw-chip` styles (neutral surface + brand accent bar) and brand yellow/green palette tokens
- **Splash:** step-weighted install progress (percent + bar + hex), square window, activity dots / shimmer, and elapsed timer

### Changed

- **UI:** status banners, validation messages, job cards, footer chips, and job toasts use the shared notice/chip styles instead of ad-hoc colored boxes
- **Preparation / Builder / Equilibration / Analysis:** main content panes use the theme background color for consistent light/dark chrome
- **Splash:** status shows `Step i/n · XX%`; real % on the lower bar; hex loops independently; install updates coalesced so the UI stays in sync under load
- **Runtime install:** split bootstrap (base → AmberTools → OpenMM); skip unused `cudatoolkit`; default CPU GROMACS (CUDA via `GATEWIZARD_CONDA_GROMACS_CUDA=1`); single-flight lock; quieter console progress; elapsed time in `runtime-install.log`
- **Equilibration / Settings:** MD engine **Variant** (`CPU` / `CUDA` / …); unified **Compute target** (Auto / CPU / CUDA, plus OpenCL / Metal for OpenMM) with local-vs-script chips (fixes OpenMM CPU selection snapping back to Auto)
- Requires gatewizard API **1.0.51** (job metadata, GROMACS minimization progress, OpenMM resume labels)

### Fixed

- **Equilibration:** OpenMM per-stage simulated ns no longer accumulates across stages (gatewizard `parse_openmm_log` fix)
- **Equilibration:** Continue dialog and resume labels show the correct stage name after kill mid-run (e.g. **Equilibration 2**, not stage 1)
- **Equilibration:** GROMACS minimization stages show steps and wall time (not ns/day); hover tooltip when minimization converged early before all requested steps
- **Linux / WSL:** splash/main open on the console’s Windows monitor — WSLg is one wide X11 screen, so placement maps Windows monitor work areas into that virtual space
- **Settings → Versions:** “Download GUI” prefers the Linux `.deb` (not AppImage); under WSL opens the Windows host browser (`cmd.exe start` / `wslview`) when `xdg-open` fails; shows the download URL and an error if the browser cannot open
- **Build:** theme antiflash script uses `type="module"` so Vite bundles it into the packaged renderer

## [1.0.11] - 2026-07-15

### Fixed

- **Builder:** ligand parametrization writes `ligand_params/` under the Builder output folder (working directory + left-panel folder name), not next to the input PDB.
- **Builder:** Initial / Final ligand 2D controls are toggles to display initial PDB vs parametrized mol2.
- **File dialogs (Linux):** open dialogs start in the set working directory; if none is set, use the directory where GateWizard was launched (avoids GTK “Recent” as the default view)
- **Settings → Versions:** Regroup dependencies in External Python Packages, External tools, and MD Engines lists. All available engines are discovered as in Equilibration page.
- **Settings:** fixed dialog height so switching tabs (Notifications → Versions, etc.) does not resize/recenter and shift the left nav under the cursor
- **Visualize:** MemPro / Packmol panels keep a visible warning when no working directory is set; Fill with water / Run MemPro ask to confirm before proceeding without one
- **Preparation:** terminal-caps warning only for the selected working file (not the post-PropKa `*_capped.pdb`); Run PropKa disabled when pH/Cap unchanged; always refreshes from the initial PDB; Old ID / New ID columns; pdb4amber “Gaps” note clarified
- **Visualize:** covalent bonds are precalculated on structure load (`needs_bonds`), so ball-and-stick is ready without a second wait
- **Preparation:** split protonation table + embedded 3D viewer (tube protein, CPK ball-and-stick on row / Ctrl+click multi-select); approximate ghost H preview when State changes (`/preview-protonation`)
- **Visualize / Preparation:** fixed `/get-structure` crash when guessing bonds on a newly cached file (`bond_guessed` on None cache entry)
- **Builder:** MD engine selector only shown for 4-site waters (OPC / TIP4P-D / TIP4P-Ew), with a short note that NAMD needs FlexibleWater; hidden for other water models (generic Amber path)
- **Visualize:** large-system load — auto-use companion `.prmtop`/`.psf` when beside the PDB (skip full `guess_bonds`); solute+water bond fallback; columnar atom payload + gzip; centered 3D spinner with elapsed time; optional “Open with topology…”
- **Visualize:** ball-and-stick reuses bonds already loaded with the structure (filter by selection) instead of re-calling `/get-structure` when switching protein/ligand views
- **Linux (GNOME):** maximized frameless window no longer leaves an extra gap under the top panel (Windows taskbar reserve was incorrectly applied on Linux)
- **Linux / WSL:** when maximized under WSLg, keep the Windows 11 taskbar visible (taskbar reserve still applies on WSL; native Pop/Ubuntu trust workArea only)
- **Linux / WSL:** packaged `.deb` maximize no longer covers the Windows taskbar (differs from `npm run` `dev` — desktop launches often lack `WSL_*` env; force host-taskbar margin + broader WSL detection)
- **Linux:** suppress Chromium `vaInitialize failed` startup noise (disable unused VA-API video decode/encode; does not affect 3D WebGL)
- **Linux (GNOME/Wayland):** dock shows GateWizard icon instead of a generic gear — set `desktopName` + `syncDesktopName`, bump electron-builder to 26.15.3 so `.desktop` id matches Electron app_id

### Changed

- Requires gatewizard API **1.0.48**

## [1.0.10] - 2026-07-14

### Fixed

- **Release:** package installers use PyPI `gatewizard[full]>=1.0.47` (local editable `-e` was a silly mistake.)

### Changed

- Requires gatewizard API **1.0.47** (same as 1.0.9)

## [1.0.9] - 2026-07-13

### Added

- **Analysis:** structural plots show the atom/residue selection under the title; toggle in Plot Settings (“Show selection on plot”)
- **Runtime:** conda-forge GROMACS in the embedded env (Linux: try CUDA then CPU; macOS: CPU). System `gmx` / GMXRC installs remain usable alongside.
- **Equilibration:** engine version picker — scan PATH / conda / common prefixes (incl. GMXRC); optional Custom path

### Fixed

- **Equilibration:** false “Job failed” notification when GROMACS prints unused-macro warnings that contain the phrase “spelling error” (status poll no longer treats bare `error` as failure)

### Changed

- Requires gatewizard API **1.0.47**

## [1.0.8] - 2026-07-11

### Added

- **Settings hub** (gear icon): notifications, appearance (theme), scene startup defaults, versions & updates
- **Desktop notifications** when preparation, equilibration, analysis, MemPro, Packmol, or PropKa finish (window unfocused/minimized, or a different sidebar tab; toggle in Settings). Green in-app banner above the status bar; system toasts when the window is away (not reliable on WSL).
- **Startup update check** with badge on Settings and a dismissible “Updates available” dialog
- **App-wide error dialog:** scrollable, bounded height, Copy + OK (replaces oversized native `alert` on Mac)
- **Preparation:** warn when Cap termini is on and the PDB already has ACE/NME (or `*_capped` name); skip re-capping via backend
- **Equilibration (GROMACS):** water, ions, other, and custom MDAnalysis constraint selections (requires gatewizard with GROMACS posres support)
- **Workflow output folders** with numbered defaults per tab (`01_preparation_*`, …, `04_analysis_*`)
- **Visualize — Packmol hydration** (Tools menu, interactive box, volume estimate, fill cavity, custom input)
- Packmol hydration output history (load prior jobs from the working directory)
- Shared sidebar styling across workflow tabs
- Linux multi-size icon generation for packaging
- **Preparation:** “Remove protein hydrogens” before pdb4amber (on by default; ligands/hetero kept)
- **Builder:** Advanced “Remove protein hydrogens”; warning when protein H detected with link to Advanced
- **Visualize:** Points representation (lightweight default for new reps); right-click Duplicate / Remove on representations
- **Visualize:** Split representation by chainID (context menu + View settings)
- **Visualize:** Subtle atom count when a structure is loaded
- **Equilibration:** Loading indicator while system is loaded after selecting an input folder
- **Clear** action on Preparation, Builder, Equilibration, and Analysis (replaces Preparation Reset)

### Changed

- Scene rendering settings no longer auto-persist from the Visualize panel; optional **Remember scene defaults** in Settings
- Dependency versions UI moved into Settings (replaces the grimoire icon)
- Sidebar theme toggle is session-only; startup theme is set in Settings → Appearance
- **Builder:** Sticky job log follow (pauses when scrolled up); number steppers for water/boundary distance
- **Preparation:** Number steppers for target pH and max S–S distance
- **Builder:** Cleaner sidebar; explicit box mode hides water/boundary fields
- **Builder:** `--notprotonate` restored in Advanced settings (on by default) to keep PropKa states
- **Visualize:** “Add view” renamed to “Add representation”; new reps default to Points instead of vdW
- **Visualize:** Selection placeholder uses valid MDAnalysis syntax (`chainID A · resid 1:20`)
- **Visualize:** Double-click a representation label to edit its selection inline
- **Visualize:** Color scheme label “Goodsell” renamed to “Pastel” (color only; material stays Goodsell)
- **README:** Fedora AppImage install notes
- Requires gatewizard API **1.0.46**

### Fixed

- **Preparation:** PropKa with Cap on an already-capped PDB no longer fails with Topology `elements` errors
- **Visualize:** 3D viewer stays aligned on panel resize; MemPro/Packmol panels close correctly after reload
- **Visualize:** Ghost water preview matches calculated free volume, not the full box
- **Equilibration:** NPgT ensemble sent correctly (`NPgT`, not `NPGT`)
- **Equilibration:** Sidebar scroll layout
- **Preparation:** Prepare no longer looks for `*_capped_capped.pdb` after PropKa capping

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
