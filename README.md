# GateWizard GUI
<img src="./resources/brand/logos/splash.png" alt="GateWizard" width="140" align="right" />

Desktop application for membrane protein preparation, system building, equilibration setup, and MD trajectory analysis

**This repository is the GUI only.** It is independent from the Python API and is distributed on its own.

The app uses the **[GateWizard API](https://github.com/maurobedoya/gatewizard)** under the hood. You do not need to clone the API repo to run the GUI, it installs `gatewizard` into its embedded Python environment. You can also use the API alone from Python or Jupyter without this app.

💬 **Questions and community help** → [gatewizard Discussions](https://github.com/maurobedoya/gatewizard/discussions) (shared forum for API and GUI; use labels `gui` or `gui:installation` for app topics)

[<img src="./resources/readme/main_viewer.png" width="600" alt="GateWizard desktop application" align="left" />](./resources/readme/main_viewer.png)

<br clear="left" />

## Features

- **Preparation** — clean structures, pKa (PROPKA), protonation, and termini capping
- **Membrane builder** — orient protein, pack lipids and solvent, Amber parametrization (tleap)
- **Equilibration** — CHARMM-GUI-style protocols for NAMD, GROMACS, and OpenMM (NVT, NPT, NPAT, NPγT)
- **Analysis** — trajectory metrics, structural analysis, and plotting helpers
- **Force fields** — Amber protein models (e.g. ff14SB, ff19SB) and common water/lipid setups
- **Cross-platform** — Linux (including WSL on Windows) and macOS installers

## Install

Download the installer for your platform from [Releases](https://github.com/franciscoadasme/gatewizard-gui/releases).

**First launch** downloads Python packages in the background (several minutes). Keep the splash screen open — progress is shown there.

Install logs:
- **Linux / WSL:** `~/.config/gatewizard-gui/runtime-install.log`
- **macOS:** `~/Library/gatewizard-gui/runtime-install.log`

### Windows (via WSL)

Native Windows installers are **not published**. On a Windows PC, install **WSL 2** and use the **Linux** build (full MD workflow: ``AmberTools, membrane builder, OpenMM).

**Supported distros (tested):**

| Environment | Ubuntu / Debian / Fedora | Notes |
|-------------|-----------------|-------|
| **WSL** | **24.04** | Recommended — WSLg, Electron, and the embedded runtime work reliably |
| WSL | 26.04 | Supported when WSLg GPU files exist (`/dev/dxg`, `libd3d12.so`); the app selects Mesa d3d12 automatically |
| WSL | 22.04 | Not recommended — GUI/display issues (WSLg, DBus) are common; upgrade to 24.04 |
| **Native Linux** | 22.04 or newer | Full support on a standard desktop with X11 or Wayland |

On WSL, use a recent **WSL 2** install with **WSLg** enabled (`wsl --version` should list WSLg). After `wsl --update`, run `wsl --shutdown` once if the app cannot open a window.

**`.deb` (Ubuntu/Debian/WSL):**
```bash
sudo apt install ./gatewizard-gui-*-linux-amd64.deb
gatewizard-gui-linux
```

**AppImage:**
```bash
chmod +x gatewizard-gui-*-linux-x86_64.AppImage
./gatewizard-gui-*-linux-x86_64.AppImage
```
**Fedora Linux:**

Install FUSE support, then run the AppImage:

```bash
sudo dnf install -y fuse fuse-libs
chmod +x gatewizard-gui-*-linux-x86_64.AppImage
./gatewizard-gui-*-linux-x86_64.AppImage
```

On first launch, the app creates its internal Python environment and may download about 1 GB of packages. Keep the splash screen open until setup finishes.

Install log:

```bash
~/.config/gatewizard-gui/runtime-install.log
```

#### Display GPU (splash and Visualize)

This is the Electron / WebGL path, not OpenMM or GROMACS compute. There is no native Windows app — on Windows, use WSL.

| Runtime | What the app does |
|---------|-------------------|
| WSL with `/dev/dxg` and `/usr/lib/wsl/lib/libd3d12.so` | Sets `GALLIUM_DRIVER=d3d12` before Chromium starts (fixes Ubuntu 26.04 Mesa defaulting to llvmpipe). Mesa picks the adapter — the app does **not** hardcode NVIDIA. |
| WSL without those files | Leaves Mesa (often software GL; 3D is slower). |
| Native Linux | Unchanged (Mesa or the NVIDIA driver). |
| macOS | Unchanged (Metal). |

If Chromium’s GPU process crashes, the app relaunches in software mode (SwiftShader) and writes `gpu-policy.json` so the next launch stays on software:

- Linux / WSL: `~/.config/gatewizard-gui/gpu-policy.json`
- macOS: `~/Library/gatewizard-gui/gpu-policy.json`

Retry hardware:

```bash
GATEWIZARD_GPU_RETRY=1 gatewizard-gui-linux
```

Overrides (always win):

| Variable | Effect |
|----------|--------|
| `GATEWIZARD_GPU_SAFE_MODE=1` | SwiftShader software rendering |
| `GATEWIZARD_GALLIUM_DRIVER=llvmpipe` | Force Mesa software GL (empty value disables auto d3d12) |
| `GALLIUM_DRIVER` | Left as-is if already set |
| `MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA` | Optional, if Mesa picked the wrong GPU on a hybrid laptop |

WSL often has no session D-Bus. The app starts one when needed so Chromium does not print `Failed to connect to socket /run/user/…/bus`.

If the splash screen appears but the main window never opens on WSL, force software rendering:

```bash
GATEWIZARD_GPU_SAFE_MODE=1 gatewizard-gui-linux --ozone-platform=wayland
```

The `gatewizard` PyPI package is the **Python API library** only (no console command). This app is launched as `gatewizard-gui-linux` or `gatewizard-gui-mac`.

Use the same `.deb` or AppImage steps above on **native Linux** desktops (Ubuntu 22.04+).

### macOS

GateWizard releases from GitHub are **not Apple-notarized** yet. macOS may block the app the first time — that is normal for unsigned downloads.

#### Install

1. Download the `.dmg` for your Mac from [Releases](https://github.com/franciscoadasme/gatewizard-gui/releases) (Apple Silicon: `*-mac-arm64.dmg`).
2. **Double-click** the `.dmg` to open it.
3. **Drag** `gatewizard-gui-mac.app` into **Applications**.
4. **Eject** the disk image.
5. Open **Applications** and launch **gatewizard-gui-mac** (do not run the app from inside the `.dmg`).

#### If macOS says it cannot verify the app

You may see a dialog like *“Apple could not verify that gatewizard-gui-mac is free of malware”*.

**Recommended (works on most Macs):**

1. Try to open the app once (it will be blocked).
2. Open **System Settings → Privacy & Security**.
3. Scroll down and click **Open Anyway** next to the GateWizard message.
4. Confirm **Open** in the next dialog.
5. Launch the app again from **Applications**.

**Alternatives:**

- **Right-click** `gatewizard-gui-mac.app` → **Open** → **Open** (first launch only).
- Terminal (removes the “downloaded from internet” quarantine flag):
  ```bash
  xattr -cr /Applications/gatewizard-gui-mac.app
  ```

Do **not** click **Move to Trash** in the Gatekeeper dialog — that deletes the app.

#### First launch

Wait on the splash screen until the main window appears (first run often **5–15 minutes** while Python packages install). Progress text appears below the logo.

Update the API later from the left sidebar: open **Settings** (gear), then **Versions & updates** → **Check for updates**.

#### Troubleshooting: `pip upgrade (tools) failed` / SSL not available

If the log shows **`SSL module is not available`** or **`libcrypto.3.dylib (not a mach-o file)`**, the embedded Python environment under `~/Library/gatewizard-gui/mamba-env` is **corrupted** — this is **not** a Homebrew issue. GateWizard uses its own conda Python, separate from anything you installed elsewhere.

**Fix (recommended):**

1. Quit GateWizard completely.
2. In Terminal:
   ```bash
   rm -rf ~/Library/gatewizard-gui/mamba-env
   rm -f ~/Library/gatewizard-gui/runtime-state.json
   ```
3. Relaunch **gatewizard-gui-mac** from **Applications** and wait for the splash screen to finish (the runtime reinstalls from scratch).

**If it happens again:** exclude `~/Library/gatewizard-gui` from **iCloud Desktop & Documents** sync — iCloud can corrupt binary libraries inside `mamba-env`.

**Verify after reinstall:**

```bash
~/Library/gatewizard-gui/mamba-env/bin/python -c "import ssl; print(ssl.OPENSSL_VERSION)"
```

You should see a line starting with `OpenSSL` (not an `ImportError`).

Newer app versions detect broken SSL on launch and remove the corrupted environment automatically before reinstalling.

## Dependencies

GateWizard is split across two repositories ([API](https://github.com/maurobedoya/gatewizard) + this GUI). Below is the **full dependency stack**; subsections mark what **this repo** installs automatically.

### Python — core (`pip install gatewizard`) · *[gatewizard](https://github.com/maurobedoya/gatewizard)*

| Package | Role |
|---------|------|
| Python ≥ 3.8 | Runtime |
| NumPy | Numerical arrays |
| Matplotlib | Plots and analysis figures |
| MDAnalysis | Trajectories and topologies |
| lipyphilic | Membrane / lipid analysis |
| PROPKA | pKa and protonation |
| RDKit | Ligand 2D structures |
| Pillow | Image I/O |
| psique | Structure / sequence tools |
| requests | HTTP helpers |

### Python — optional `[full]` · *API; installed via embedded runtime*

| Package | Role |
|---------|------|
| ParmEd | Topology conversion (GROMACS, etc.) |
| OpenMM | Equilibration / MD (Python; use with conda `cudatoolkit` for GPU) |
| MemPrO | Membrane orientation ([GitHub](https://github.com/pstansfeld/MemPrO)) |

### Python — GUI backend · *this repo (embedded runtime)*

| Package | Role |
|---------|------|
| Python 3.12 | Embedded micromamba env |
| FastAPI | Local HTTP API |
| Uvicorn | ASGI server |
| gatewizard[full] | GateWizard API (pip, from `backend/requirements.txt`) |

### Conda (embedded runtime · automatic on first start)

| Package | Linux / WSL | macOS | Native Windows |
|---------|-------------|-------|----------------|
| AmberTools 24 | yes | yes | no — use WSL |
| OpenMM (conda) | yes | yes | no |
| cudatoolkit (OpenMM CUDA) | yes | no (Metal) | no |

After `pip install gatewizard[full]`, the app re-syncs conda OpenMM packages on Linux/WSL so GPU support is kept.

Same packages are in the API [`environment.yml`](https://github.com/maurobedoya/gatewizard/blob/main/environment.yml) for conda-based API installs.

### Desktop app · *this repo (`npm install` / installer)*

| Package | Role |
|---------|------|
| Electron | Desktop shell |
| Node.js 20+ | App and build runtime |
| Svelte 5 | UI framework |
| Vite | Frontend bundler |
| Tailwind CSS | Styling |
| Three.js + Threlte | 3D structure viewer |
| electron-updater | In-app update checks |

### External MD engines (install separately · neither repo)

| Tool | Role |
|------|------|
| [NAMD](https://www.ks.uiuc.edu/Research/namd/) | Run NAMD equilibration — `namd3` / `namd2` on `PATH` |
| [GROMACS](https://www.gromacs.org/) | Run GROMACS equilibration — `gmx` on `PATH` |

OpenMM needs no separate binary — provided by `gatewizard[full]` + conda above. Check platforms on **Equilibration → OpenMM** after install.

### Provided by this repository

| Component | Included |
|-----------|----------|
| Desktop app (Electron, Svelte, Three.js viewer) | yes |
| Embedded Python + FastAPI backend | yes |
| `gatewizard[full]` (pip) | yes — on first start / API update |
| AmberTools, OpenMM, cudatoolkit (conda) | Linux/WSL/macOS only |
| NAMD / GROMACS binaries | no — user install |
| Standalone API package source | no — [gatewizard](https://github.com/maurobedoya/gatewizard) |

### Platform notes

| Platform | Full workflow (builder, equilibration) |
|----------|----------------------------------------|
| Linux / WSL | Yes |
| macOS | Yes, where AmberTools is available |
| Native Windows | Not supported — use WSL with the Linux build |

### Python API (optional)

If you prefer scripts or notebooks without the desktop app: **[github.com/maurobedoya/gatewizard](https://github.com/maurobedoya/gatewizard)**

```bash
pip install gatewizard
```

## Development

Requirements: **Node.js 20+**, **npm**. For the full MD workflow, use **Linux or WSL** (AmberTools and related tools).

```bash
git clone https://github.com/maurobedoya/gatewizard-gui.git
cd gatewizard-gui
npm install
npm run dev
```

`npm run dev` applies the same display-GPU policy as the packaged app (WSL d3d12 when GPU files exist). `npm run dev:wsl` is an explicit **software-only** hammer (`LIBGL_ALWAYS_SOFTWARE` + SwiftShader) — use it only to debug a broken GPU stack, not as the default:

```bash
npm run dev:wsl
```

Install `npm` dependencies in **one environment only** (WSL or Windows), not both on the same folder.

### Build installers

| Platform | Command | Release artifact (example) |
|----------|---------|----------------------------|
| Linux / WSL | `npm run build:linux` | `gatewizard-gui-1.0.11-linux-x86_64.AppImage`, `.deb` |
| macOS | `npm run build:mac` (on macOS) | `gatewizard-gui-1.0.11-mac-arm64.dmg` |

CI publishes **Linux and macOS only**. A native Windows `.exe` can be built locally (`npm run build:win:pack`) but is not shipped on GitHub Releases.

## Community and support

| Need | Where |
|------|--------|
| Questions, workflows, install help | [Discussions](https://github.com/maurobedoya/gatewizard/discussions) on the API repo (label `gui` or `gui:installation`) |
| GUI bug or feature | [Issues](https://github.com/franciscoadasme/gatewizard-gui/issues/new/choose) in this repo |
| API bug or feature | [Issues](https://github.com/maurobedoya/gatewizard/issues/new/choose) in gatewizard |
| API docs and troubleshooting | [Documentation](https://maurobedoya.github.io/gatewizard/) |

New to the project? Read the [welcome post](https://github.com/maurobedoya/gatewizard/discussions/36).
