# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Analysis custom plot grid:** Overlay uses an ordered set list (add / up / down / remove). Custom grid is a session-persisted mosaic (columns × rows, gap, aspect, last-row align, legends, reference lines). Plot settings can target **All cells** or **This cell**; each square has a list button for that cell’s sets, draw order, and title. Line width/dash apply to structural and energetic plots. Live SVG matches publication PNG.
- **Analysis RMSD reference PDB:** optional starting structure instead of Ref. frame. PDB/GRO files in the trajectory list are ignored when DCD/XTC files are present (they have no periodic box and were breaking membrane thickness).
- **Analysis area per lipid:** show/hide Average, Upper leaflet, and Lower leaflet on the plot (and publication PNG). CSV still stores all three.
- **Builder:** bilayer-only packing (uncheck **Include protein**, set **Membrane XY**) and **Free molecules** (`--solute` / `--solute_con`, optional in-membrane and protein distance). Protein+membrane jobs are unchanged.
- **Analysis area per lipid:** exclusion-aware Voronoi APL (**EVAPL**, default) — **Exclude selection** (default `protein`; also peptide, DNA, ligands) and **Exclude cutoff (Å)** (default **30**) so occupants reduce mean APL instead of tiling the full box.
- **Analysis:** **Cancel analysis** while a run is in progress (single set or all sets). The UI unblocks immediately and shows “Analysis cancelled” instead of a browser abort error.
- **Analysis trajectories:** per-file time offset (ns) accepts **four decimal places** (e.g. `200.1234`, `2000.1234`); inputs use `0.0001` step and a wider field.
- **Analysis run all sets:** skips hidden sets and sets missing trajectories/logs, then continues with every remaining set that has data (empty sets in between no longer stop the batch).

### Changed

- **Analysis plot layout:** Overlay vs grid is a toolbar (icons + add/remove column/row). Mosaic extras live under **Grid options**; **Advanced** holds margins, tick chrome, and fonts. Min/max fields are wider than ticks/decimals; reference lines stay in the sidebar (value/width, then style/label). **Reset view** clears zoom/pan only; a menu also resets axis limits. Trajectory/log list and Time (ns) are inputs for the next Run (the plot comes from the last analysis CSV). Dash gaps scale with line width.
- **Analysis area per lipid:** the GUI now picks the algorithm — **EVAPL** (Exclusion-aware Voronoi Area Per Lipid, default), **Box Voronoi (lipyphilic)**, **GridMAT-MD**, or **VTMC** — with the matching settings (exclude cutoff, grid points/precision, MC samples/protein radius). LiPyphilic shows a warning that it is for **pure lipids only** (not systems with protein or other leaflet occupants).
- **Equilibration Pull progress:** local-size poll no longer skips updates when integer % is unchanged (large files were freezing the ring/status for long stretches). Status line prefers live on-disk bytes over stale stream text; pull start reports existing local size instead of `0 / remote`.
- **Tools Fix PBC (GROMACS):** no longer shows yellow “no .tpr / provide index” warnings as soon as a PDB topology is chosen. Detect uses the GROMACS TPR / Index browse fields, and also looks for `step*.tpr` / `index.ndx` next to the topology (not only next to trajectories).

### Fixed

- **Equilibration startup:** a Python-style `.lower()` call crashed on launch (`String(...).lower is not a function` in `isSidebarControlledStage`). Every page stays mounted, so that uncaught `$effect` error froze tab switching even if Equilibration was never opened.
- **Analysis Overlay/Grid:** clicking Grid or loading a session no longer freezes the app. Mosaic cells use padding-bottom instead of CSS `aspect-ratio` (Chromium could tight-loop layout in a flex + overflow pane). Chart-width observers no longer retrigger layout every frame.
- **Analysis custom grid:** set checkboxes hide or show series in mosaic cells (not only overlay). X/Y tick counts and the axis box apply to overlay and grid.
- **Tools Fix PBC:** Amber/NAMD/OpenMM default center is protein + bilayer. Loading a PSF/PDB no longer resets the field to protein-only; detected lipid residue names (e.g. POPC) replace the generic list when present.
- **Equilibration Progress:** Watch / Reload rediscover cluster jobs whose `equilibration_job.json` lost `mode` / `scheduler_job_id` (they used to stay **Ready** forever). Connect + Reload on a folder with `run_equilibration.slurm` queries Slurm by job name and restores remote status. After sbatch, the job JSON (with the Slurm id) is copied to the remote submit dir.
- **Equilibration:** bilayer-only / non-protein input omits protein backbone and sidechain restraint rows (and turns off protein COM). Generate Input Files matches the API so OpenMM no longer looks for `restraints/prot_pos.txt`.
- **Preparation / Builder output path preview:** with a working directory set but no PDB yet (so no folder name), the preview no longer says to set a working directory; it shows the placeholder path (or asks for a folder name). Preparation input is labeled **PDB file** and the browse dialog is PDB-only (PropKa/pdb4amber do not accept CIF/mmCIF/ENT). Preparation and Builder share the stacked PDB path + full-width select button layout.
- **Equilibration Pull progress:** bar and status line use the same byte ratio as the local/remote size ring; percent lives on the sync ring only. On-disk folder size drives progress so resumed pulls do not jump backward. **Cancel pull** on job cards and in the cluster dialog stops rsync without closing the app; shows “Pull cancelled” instead of a browser abort error. While pulling, the status line shows a spinner plus transfer rate (from rsync or measured from on-disk growth). Large trajectory files (e.g. DCD) now advance the bar while rsync’s temporary partial file is still growing, not only after the file finishes.
- **Analysis structural Pub PNG:** overlay y-limits use the full combined range of all series (e.g. area-per-lipid mean + upper/lower leaflets), not only the first series.
- **Analysis structural type switch:** switching RMSD ↔ membrane thickness / area per lipid shows a chart overlay and sidebar “Switching…” spinner again while headgroup detection and CSV hydrate run; stale plots are cleared immediately so the old chart is not left visible during the wait.
- **Analysis Pub PNG:** matplotlib export uses the headless Agg backend so backend logs no longer show Tk/Tcl errors on WSL (`main thread is not in main loop`, `Tcl_AsyncDelete`).
- **Analysis PNG/SVG export:** wait for chart SVGs to mount after plot remounts (spinner from click, notice if not ready) instead of failing silently.
- **Analysis structural Pub PNG:** full trajectory x-range per set in grid mode (no shared zoom x-limits); y-axis min/max from plot settings still apply.
- **Analysis energetic Pub PNG:** respects Compare layout (overlay / one panel per property / one panel per set), matching on-screen panels and set colors.
- **Equilibration cluster Connect / Run on cluster:** wait for inventory probe before Watching/runtime log sync; dialog reacts when probe finishes and can seed Resources from cached `last_probe`. Prevents empty partitions/nodes for 1–2 minutes when many remote jobs compete for SSH.
- **Analysis output folder:** clearing the left-panel name no longer forces `04_analysis` back into the field; the default stays as placeholder ghost text so any name can be typed. Run/Save still resolve an empty field to the default. Adding or switching simulation sets (and picking a topology) no longer overwrites a custom output folder name.
- **Equilibration Progress Reload:** If the job folder was deleted, Reload removes the stale card instead of showing an error alert (same outcome as a full Progress rescan).
- **Equilibration Use in form:** After loading a job, switching **Engine** or **Ensemble** updates Production to follow the sidebar again, and fills engine-specific stage fields (e.g. NAMD margin, barostat pressure/γ). Thermalization/scaffold/packing (Eq1–6) stay NVT/NPgT. No longer requires Clear form.
- **Equilibration Edit constraint:** light-mode Name / force-constant contrast; selection count uses the builder input directory (no longer always “Invalid selection”).
- **Equilibration Use in form (recovered jobs):** sticky “all NPT” protocols from older OpenMM metadata heal are corrected from on-disk inputs (packing → NPgT, finals → real ensemble). Requires updated `gatewizard` job-metadata inference.
- **Equilibration Progress:** Cluster Connect stays visible with only local jobs or an empty list (no longer requires the Remote location filter).
- **Remote job dialog:** Time-limit ± controls use tight hit targets (no nested labels) so nearby taps on touchscreens no longer change the value; time limit sits on its own row under Partition (days / hours / minutes + Slurm time on one line).
- **Equilibration (Amber resources):** GUI defaults match the API — MD stages use GPU (`pmemd.cuda`, CPU×1); only the first packing barostat stage stays CPU×6. Sidebar compute target is no longer forced to CPU-only.
- **Equilibration Stages/Details on running jobs:** merging live log stages with the protocol outline no longer falls back by index (Minimization + OpenMM Eq1… misaligned and duplicated stage names, which broke the Stages/Details panel). Match by stage name only.
- **Analysis structural grid:** titles, y-labels, and last x-ticks no longer clip; each panel clips itself so inner series are not cut at t=0. When labels/tick numbers are only on the first column or last row, inner cells keep the same plot-box size. Last/first x values sit on their ticks; extra left margin 0 does not leave a gutter. PNG/SVG exports the whole mosaic; publication legends stay print-sized.
- **Analysis membrane thickness:** starting PDB files listed as trajectories no longer crash with `NoneType` / `Box is None`.

### Added

- **Preparation / Builder / Equilibration output path:** folder browse button (same as Tools and Analysis) to choose a parent directory outside the top-bar working directory; path preview and “Use working directory” when a custom parent is set. Job scans include the custom parent so Progress / Builder cards still find those folders.
- **Equilibration progress cards:** each stage row shows its planned simulation time from the protocol (e.g. `(0.125 ns)` on pending stages, `(0.233 / 0.125 ns · …)` while running). The stages summary uses two lines — **Simulated** (accumulated so far) and **Protocol total** (full planned MD time for all stages).
- **Analysis export:** optional file name for CSV / SVG / PNG. PNG/SVG save every on-screen panel (overlay or separate sets). Pub PNG (matplotlib style) is on both Structural and Energetic and includes every visible set in the legend. Buttons show a spinner while writing.
- **Builder job cards:** Cancel while a preparation job is running (same pattern as Tools Fix PBC).
- **Builder job cards:** **Start** on generated (`not_started`) cards so older input folders can be run later; sidebar Start Preparation still targets the newest pending job.
- **Tools Fix PBC (GROMACS):** multi-check center/output index groups (merged server-side), Lipids preset, skip-cluster toggle, and job-card labels for effective center/output (`GW_CENTER = PA+PC+OL`).
- **Remote job dialog:** optional **GPU type** select from probed node/partition GRES. Writes `#SBATCH --gres=gpu:TYPE:N` when set; Any keeps `#SBATCH --gpus=N`. Stored in `execution.resources.gpu_type`.
- **Cluster profiles:** optional **Default job time limit** (`default_time_limit`, Slurm `#SBATCH -t`) used when opening Remote job for a new submit.

### Changed

- **Sidebar output folder:** Preparation, Builder, and Equilibration use the shared `OutputPathFields` control (folder name + browse parent path), matching Tools and Analysis.
- **Sidebar output folder placement:** Preparation, Builder, and Equilibration place the output folder next to the primary actions (Prepare / Generate / Run), matching Tools and Analysis, instead of under Input at the top.
- **Equilibration default protocol:** Eq6 packing extended from 17.625 ns to **47.625 ns** so Eq1–6 total **50 ns** of MD (was 20 ns) in GUI `base.json` and matching banner copy.
- **Equilibration Eq1 label:** renamed from “heat/heating” to **thermalization** (velocities are assigned at the target temperature; there is no temperature ramp).
- **Equilibration Run on cluster:** opening the remote dialog from a progress card now seeds CPU/GPU from that job's protocol and saved resources (e.g. 1 CPU + 1 GPU) instead of the left-panel sidebar defaults (often 6 CPU).
- **Analysis Save / Load:** Saving… / Loading… spinners and in-progress notices while the session CSV/JSON is written or read; Save, Load, and Browse stay disabled until it finishes.
- **Equilibration protocol cards:** hide settings the selected engine does not wire (e.g. NAMD-only margin). Trajectory frequency is shown for all engines and labeled by engine (DCD / XTC / NetCDF). Pressure and surface tension are shown when the stage ensemble uses a barostat / membrane tension path. Stage descriptions moved to an info-hover control with clearer wording.
- **Equilibration default protocol (`base.json`):** universal membrane packing for all engines — Minimization → NVT thermalization → NVT scaffold (Eq2) → NPgT packing (Eq3–6, 50 ns MD) → production uses the sidebar ensemble.
- **Equilibration banner:** thermalize/scaffold under NVT, pack under NPgT for 50 ns of MD, then production in the selected ensemble.

## [1.0.13] - 2026-08-06

### Added

- **Analysis:** optional session name (alongside output folder name) for saved sessions — shown in the picker, load/save notices, and “Current:” identity under Saved analysis
- **Analysis:** Save when already up to date shows a short “Latest changes are already saved” notice under Saved analysis, then hides it (uses a save fingerprint so the message still appears after load/hydrate)
- **Analysis:** Clear resets left-panel settings and empties all plotted charts; mode/type/set/property view changes show a Visualize-style blur + spinner on the plot panel while charts update
- **Analysis:** energetic CSV/session stores all analyzed properties (not only checked ones); property checkboxes only show/hide plots from that full data; Run analyzes every detected property
- **Analysis:** simulation sets for structural and energetic runs — overlays, per-file stride/time, save/load sessions, chart tools (pan, zoom, range stats), and mixed structural+energetic sessions
- **Analysis:** membrane thickness / APL headgroup picking, energetic compare layouts (by property / by set / overlay), and PlotSpec-style PNG export
- **Tools:** Fix PBC job UI (engine detect, per-file stride, center selection, job cards)
- **Equilibration protocol:** explicit Minimization stage; per-stage CPU/GPU on protocol cards with bulk **Apply to MD stages**
- **Equilibration:** temporary banner that current protocols are for testing only (not production) while engine protocols are still changing
- **Equilibration Progress:** Order filter (Newest / Oldest) — cards default to newest generated job folder first
- **Equilibration (NAMD):** GPU-resident mode toggle (default on with GPU) — writes `GPUresident` on the production stage only; equilibration keeps `reassignFreq`/`reassignTemp`
- **Equilibration Progress:** job cards for local and remote runs — Watch, Pull, sync ring, expandable Stages/Details with log viewer, location/status filters, shared cluster **Connect** in the toolbar
- **Equilibration (remote / Slurm):** cluster profiles in Settings; **Run on cluster…** from job cards (connect/probe, modules, partitions, verified upload before sbatch); SSH passwords are session-only, never saved
- **Equilibration (Amber):** engine option alongside NAMD/GROMACS/OpenMM — generate/run/status, executable discovery in Settings, compute targets CPU/CUDA
- **Builder:** Amber in the 4-site water MD-engine select (FlexibleWater remains NAMD-only)
- **Analysis:** Amber energetic engine option (mdout parsing)
- **Equilibration:** **Use in form** loads the job’s protocol stages into the right-hand protocol editor (from `equilibration_job.json` / `protocol_summary.json`), not only the left-panel settings
- **Visualize — Animation:** keyframe timeline with playback, per-track fades/easing, safe-area guide, and export to video (ffmpeg) or frame sequence
- **Visualize — Animation:** Cancel button while rendering/encoding an export (stops between frames and kills FFmpeg if encoding)
- **Visualize — Viewpoints:** save/open a full view snapshot (structure, camera, representations, lights, labels, measurements)
- **Visualize — Labels:** background color/opacity, padding, corner radius, and lift distance/direction (works in live view and animation)
- **Visualize — Labels:** show/hide all labels from the Labels panel header (does not delete labels)
- **Visualize — Measurements:** same chip styling as labels (size, opacity, pad, round, lift, background) with show/hide all; type icons kept on each row; styles animate and save in viewpoints
- **Visualize — Depth of field:** camera-style focus blur in Scene rendering settings (enable, focus distance, range, blur); **Focus here** from the atom menu / toolbar; saved in viewpoints and animation keyframes (enable/disable fades via blur strength between keyframes)
- **Runtime:** conda-forge **FFmpeg** is installed with the embedded micromamba environment (Linux / macOS / WSL) so animation video/GIF export works without a separate system FFmpeg
- **Visualize:** split a representation by chain, residue, residue name, molecule, or element (not only chain)
- **Settings:** About section with authors and contributors, MIT license, and project links

### Changed

- **README:** refreshed Visualize main window screenshot (`resources/readme/main_viewer.png`)

### Fixed

- **Analysis:** structural selections are stored per analysis type (RMSD vs area-per-lipid / membrane thickness), so protein/backbone and lipid headgroup choices no longer overwrite each other; bilayer runs auto-detect headgroups when the selection is empty or still protein-like; warn when a non-lipid selection is used for bilayer analyses
- **Analysis:** “Saved session…” notice clears after further edits; also shows a job toast when the window is unfocused or another tab is open (same pattern as analysis-finished)
- **Analysis:** multi-set progress and live chart updates; energetic compare follows set visibility (no ghost plot / wrong colors); slim sessions hydrate after load
- **Analysis:** axis unit dropdowns convert plotted values immediately (structural X/Y and energetic time/energy/pressure/temperature/volume), including multi-set compare; stats follow display units
- **Analysis:** “Saved session…” notice appears under Saved analysis (not at the bottom of the left panel)
- **Analysis:** loading a session while on Energetic shows plots immediately (no Structural↔Energetic toggle); unchecking all properties hides every plot
- **Analysis:** energetic stats table follows visible sets/properties (unique Set · Property rows; hides when unchecked)
- **Equilibration:** protocol stage strip shows a horizontal scrollbar at top and bottom (kept in sync), plus left/right nav buttons when stages overflow; mouse wheel still scrolls the page
- **Equilibration (OpenMM):** default protocol resources are CPU×1 + GPU×1 for minimization, equilibration, and production
- **Status bar History:** filter is Info / All only — Detail matched All because the unused `verbose` level was never logged; secondary `detail` events still show under All
- **Visualize:** View settings and Scene rendering settings dialogs follow app light/dark theme (body-mounted dialogs now sync the `.dark` class)
- **Visualize:** chain delete no longer blacks out the canvas; **Clear scene** vs status-bar **Clear chips**; bond-loading spinner sits next to the visibility toggle
- **Equilibration (Amber):** NPgT ensemble generation no longer fails with `Unknown scheme_type 'NPGT'` — scheme labels keep lowercase **g** (`NPgT`, form value `npgt`)
- **Equilibration Progress:** loading spinner while scanning jobs; runtime prefetch; compact toolbar (Auto, Location/Status filters); pending-in-queue UX; sync-ring alignment and remote generation date; warn when watching without Connect; selected buttons readable in light mode
- **Cluster — Watch vs Pull:** Watch polls Slurm and syncs stage logs only; **Pull** downloads files with live progress bar (**Pull (partial)** while the job is still running); sync ring compares Local/Remote folder sizes
- **Cluster — remote cards & dialog:** Slurm status, node, GPU type, allocated CPUs; path recovery and scratch log sync; resubmit after cancel continues from the last completed stage (NAMD/GROMACS/OpenMM/Amber); optional `#SBATCH --nodelist`; Amber `pmemd.cuda` when GPUs > 0; dialog reuses Progress **Connect** session and seeds resources from the form
- **OpenMM Progress cards:** log rows near 100% count as stage complete; Slurm COMPLETED only when all stages finished locally
- **Equilibration:** job cards no longer show “interrupted” while MD is actively running (show “running” instead; “interrupted” only when the process has stopped and a continue is available)
- **Equilibration:** after Kill MD, do not mark the current GROMACS stage as finished/100% when the log still contains `Finished mdrun` but steps are below `nsteps` (keep partial ns; needs matching gatewizard log-parser fix)
- **Equilibration:** compute-target warning refers to the selected executable (and suggests a matching CUDA/OpenCL build from the list) instead of implying the PC has no GPU
- **Equilibration:** GROMACS `run_equilibration.sh` now includes UI CPU/GPU settings on `mdrun` (`-ntomp`, `-nb gpu`, `-pme gpu`, `-gpu_id`); OpenMM scripts pass `--device` / `--threads` (NAMD already had `+p` / `+devices`)
- **Visualize:** moving atoms with the circular-menu gizmo no longer snaps back on dismiss; selection markers and the main representation stay on the same in-memory coordinates (late `/get-structure` responses cannot undo a transform)
- **Visualize — Animation:** select-tool hover / temporary highlight layers are cleared and excluded when capturing a keyframe (no residual yellow/ball-stick selection baked into the animation)
- **Visualize:** glowing material point lights no longer flicker while moving the pointer in select mode
- **Visualize — Animation:** GIF export works with FFmpeg (palette filter uses `-filter_complex`; frame sequence starts at `frame_000001.png`)
- **Visualize:** select / right-click only hit drawn atoms — hidden views (e.g. water) are ignored; cartoon/tube pick backbone only so VDW and ball-and-stick layers are easier to target

### Changed

- **Equilibration (remote):** generate locally first (**Run locally** on the left panel); cluster submit on the job card via **Run on cluster…**; Slurm runs `run_equilibration_cluster.sh`, local runs use `run_equilibration.sh`
- **Visualize:** transforms (gizmo / dialog) update coordinates in memory — no temp PDB on every drag; **Save PDB** writes when you choose (marker when unsaved)
- **Visualize:** Measurements and Labels sections start collapsed so representations stay easier to reach
- **Visualize — Animation:** keyframes can store sparse coordinate patches for moved atoms so playback/export can interpolate atom motion without duplicating full structures
- **Visualize — Animation:** unsaved atom moves (like unsaved color/representation edits) revert to the last keyframe when scrubbing the timeline; capture a keyframe to keep the new positions

### Notes

- Requires **gatewizard** API **>= 1.0.53**

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
