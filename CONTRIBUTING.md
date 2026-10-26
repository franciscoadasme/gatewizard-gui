# Contributing to GateWizard GUI

Thanks for helping with the desktop app. The Python library lives in a separate repository: [gatewizard](https://github.com/maurobedoya/gatewizard).

Please read the [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## Where to start

| You want to | Go to |
|-------------|--------|
| Ask how something works | [Discussions](https://github.com/maurobedoya/gatewizard/discussions) (label `gui`) |
| Report a bug or request a feature in this app | [Issues](https://github.com/franciscoadasme/gatewizard-gui/issues/new/choose) |
| Report a library bug | [API issues](https://github.com/maurobedoya/gatewizard/issues/new/choose) |
| Report a security vulnerability | [SECURITY.md](SECURITY.md) — email [gatewizard.project@gmail.com](mailto:gatewizard.project@gmail.com), not a public issue |

Search existing discussions and issues before opening a new one.

## Set up a development copy

Use **WSL** or Linux, not Windows PowerShell, and install npm dependencies in that environment.

```bash
git clone https://github.com/franciscoadasme/gatewizard-gui.git
cd gatewizard-gui
npm install
npm run dev
```

Node.js 20 or newer is required. `npm run dev` applies the same display-GPU policy as the packaged app. `npm run dev:wsl` is only for debugging a broken GPU stack (`LIBGL_ALWAYS_SOFTWARE` + SwiftShader). Install `npm` dependencies in **WSL only**, not from Windows on the same folder.

The backend uses the conda environment `gatewizard` from the API checkout. From Windows PowerShell, call that interpreter through WSL (`~/miniconda3/envs/gatewizard/bin/python`):

```bash
conda activate gatewizard
cd backend && python -m pytest
```

### Build installers

| Platform | Command | Release artifact (example) |
|----------|---------|----------------------------|
| Linux / WSL | `npm run build:linux` | `gatewizard-gui-*-linux-x86_64.AppImage`, `.deb` |
| macOS | `npm run build:mac` (on macOS) | `gatewizard-gui-*-mac-arm64.dmg` |

CI publishes **Linux and macOS only**. A native Windows `.exe` can be built locally (`npm run build:win:pack`) but is not shipped on GitHub Releases.

## Tests

Frontend and script tests:

```bash
npm test
```

Run `npm run lint` before opening a pull request. Add or update tests for behavior you change.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep the change focused on one fix or feature.
3. Describe what changed and why in the pull request.
4. Run `npm test` and the backend tests that cover your change.

For a large change, open an issue or a discussion first so we can agree on the approach.

This project is licensed under the [MIT License](LICENSE). Contributions are accepted under the same license.
