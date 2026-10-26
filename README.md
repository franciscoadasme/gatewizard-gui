# GateWizard GUI
<img src="./resources/brand/logos/splash.png" alt="GateWizard" width="140" align="right" />

Desktop application for membrane protein preparation, system building, equilibration setup, and MD trajectory analysis.

**This repository is the GUI only.** The app installs the **[GateWizard API](https://github.com/maurobedoya/gatewizard)** into an embedded Python environment. You can use the API alone from Python without this app.

📖 [Documentation](https://maurobedoya.github.io/gatewizard/) · [User guide](https://maurobedoya.github.io/gatewizard/user-guide/) · [Manual (PDF)](https://github.com/maurobedoya/gatewizard/raw/main/docs/manual/GateWizard-manual.pdf) · 💬 [Discussions](https://github.com/maurobedoya/gatewizard/discussions) (label `gui` or `gui:installation`)

[<img src="./resources/readme/main_viewer.png" width="600" alt="GateWizard desktop application" align="left" />](./resources/readme/main_viewer.png)

<br clear="left" />

## Features

- **Visualize** — 3D structures, trajectories, animation, short loops, structure checker, minimize
- **Preparation** — pKa (PROPKA), protonation, termini capping, short loops, alternate conformations
- **Membrane builder** — orient protein, pack lipids and solvent, Amber parametrization. Lipid catalog: [builder reference](https://maurobedoya.github.io/gatewizard/api/builder/#available-lipids)
- **Equilibration** — NAMD, GROMACS, OpenMM, and Amber (NVT, NPT, NPAT, NPγT), including **Run on cluster**
- **Analysis** — trajectory metrics and energetic plots
- **Cross-platform** — Linux (including WSL on Windows) and macOS

Details for each page: [User guide](https://maurobedoya.github.io/gatewizard/user-guide/).

## Install

Download the installer from [Releases](https://github.com/franciscoadasme/gatewizard-gui/releases). First launch installs the Python stack into an embedded environment (several minutes). Keep the splash screen open.

Platform steps (WSL, `.deb`, AppImage, macOS Gatekeeper): [Installation → Desktop GUI](https://maurobedoya.github.io/gatewizard/installation/#desktop-gui).

Uninstall (including `sudo apt purge` to delete the embedded environment): [Installation → Uninstallation](https://maurobedoya.github.io/gatewizard/installation/#uninstallation).

Display GPU and memory overrides: [Troubleshooting](https://maurobedoya.github.io/gatewizard/troubleshooting/#desktop-gui-display-gpu-and-memory).

## Cluster profiles

Configure Slurm hosts under **Settings** (gear) → **Clusters**. SSH key setup: [User guide → Settings and clusters](https://maurobedoya.github.io/gatewizard/user-guide/#settings-and-clusters).

## Dependencies

The first launch installs `gatewizard[full]`, AmberTools, OpenMM, and CPU GROMACS into the embedded environment on Linux, WSL, and macOS. Package list: [Installation → Dependencies](https://maurobedoya.github.io/gatewizard/installation/#dependencies).

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for `npm run dev`, tests, and building installers.

## Community and support

| Need | Where |
|------|--------|
| Questions, workflows, install help | [Discussions](https://github.com/maurobedoya/gatewizard/discussions) on the API repo (label `gui` or `gui:installation`) |
| GUI bug or feature | [Issues](https://github.com/franciscoadasme/gatewizard-gui/issues/new/choose) in this repo |
| API bug or feature | [Issues](https://github.com/maurobedoya/gatewizard/issues/new/choose) in gatewizard |
| Docs and troubleshooting | [Documentation](https://maurobedoya.github.io/gatewizard/) |
| Contributing | [CONTRIBUTING.md](CONTRIBUTING.md) |

New to the project? Read the [welcome post](https://github.com/maurobedoya/gatewizard/discussions/36).

## Citation

If you use GateWizard in your research, please cite:

- **Software:** [https://doi.org/10.5281/zenodo.18264074](https://doi.org/10.5281/zenodo.18264074)
- **Publication:** to be added

## License

GateWizard GUI is licensed under the [MIT License](LICENSE).

Copyright (c) 2025-2026 Constanza González, Francisco Adasme, Mauricio González, Janin Riedelsberger, and Mauricio Bedoya
