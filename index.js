"use strict";
const electron = require("electron");
const child_process = require("child_process");
const fs$1 = require("fs");
const fs = require("fs/promises");
const path = require("path");
const utils = require("@electron-toolkit/utils");
const url = require("url");
const crypto = require("crypto");
const appWindowIcon = path.join(__dirname, "../../resources/brand/logos/app-window-dark.png");
const __dirname$1 = path.dirname(url.fileURLToPath(require("url").pathToFileURL(__filename).href));
const LOGOS_DIR = path.join(__dirname$1, "logos");
const brandAssets = {
  /**
   * In-app window icon — title bar and OS taskbar while the app is running.
   * Use a light/white emblem on transparent PNG for the current dark UI.
   */
  appWindow: {
    files: {
      dark: path.join(LOGOS_DIR, "app-window-dark.png"),
      light: path.join(LOGOS_DIR, "app-window-light.png")
    },
    defaultTheme: "dark"
  },
  /**
   * Installed app identity — installer wizard, uninstaller, shortcuts, .exe / .AppImage / .deb / .app.
   * Often a dark/black emblem on transparent PNG (visible on light Windows UI).
   */
  packaging: {
    files: {
      source: path.join(LOGOS_DIR, "packaging.png")
    }
  },
  /**
   * Splash screen — GW emblem on the back of the 3D key card.
   * Currently inline SVG in splash.html (not loaded from a file at runtime).
   */
  splashEmblem: {
    files: {
      svg: path.join(LOGOS_DIR, "emblem.svg"),
      referencePng: path.join(LOGOS_DIR, "splash-reference.png")
    }
  }
};
path.join(__dirname$1, "..", "window_icon.png");
function resolveAppWindowIconPath(theme = brandAssets.appWindow.defaultTheme) {
  const { files, defaultTheme } = brandAssets.appWindow;
  return files[theme] ?? files[defaultTheme];
}
const PYTHON_SPEC = "3.12";
const MICROMAMBA_TAG = "2.0.8-0";
const MICROMAMBA_URL = {
  "linux-x64": `https://github.com/mamba-org/micromamba-releases/releases/download/${MICROMAMBA_TAG}/micromamba-linux-64`,
  "darwin-arm64": `https://github.com/mamba-org/micromamba-releases/releases/download/${MICROMAMBA_TAG}/micromamba-osx-arm64`,
  "darwin-x64": `https://github.com/mamba-org/micromamba-releases/releases/download/${MICROMAMBA_TAG}/micromamba-osx-64`,
  "win32-x64": `https://github.com/mamba-org/micromamba-releases/releases/download/${MICROMAMBA_TAG}/micromamba-win-64.exe`
};
let cachedLaunchPython = null;
function getMicromambaKey() {
  const plat = process.platform;
  const arch = process.arch;
  if (plat === "linux" && arch === "x64") return "linux-x64";
  if (plat === "win32" && arch === "x64") return "win32-x64";
  if (plat === "darwin" && arch === "arm64") return "darwin-arm64";
  if (plat === "darwin" && arch === "x64") return "darwin-x64";
  return null;
}
function getGatewizardDataRoot() {
  if (process.platform === "darwin") {
    return path.join(electron.app.getPath("home"), "Library", "gatewizard-gui");
  }
  return electron.app.getPath("userData");
}
async function migrateDarwinDataRootIfNeeded() {
  if (process.platform !== "darwin") return;
  const legacy = electron.app.getPath("userData");
  const root = getGatewizardDataRoot();
  if (path.resolve(legacy) === path.resolve(root)) return;
  await fs.mkdir(root, { recursive: true });
  for (const name of ["mamba-env", "mamba-root", "micromamba"]) {
    const from = path.join(legacy, name);
    const to = path.join(root, name);
    if (!await fileExists(from) || await fileExists(to)) continue;
    await fs.rename(from, to);
    if (name === "mamba-env") {
      await rewriteCondaPrefixInTree(to, from, to);
    }
  }
}
async function rewriteCondaPrefixInTree(rootDir, oldPrefix, newPrefix) {
  if (!oldPrefix || oldPrefix === newPrefix) return;
  let entries;
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(rootDir, ent.name);
    if (ent.isDirectory()) {
      await rewriteCondaPrefixInTree(full, oldPrefix, newPrefix);
      continue;
    }
    if (!ent.isFile()) continue;
    let stat;
    try {
      stat = await fs.stat(full);
    } catch {
      continue;
    }
    if (stat.size > 5 * 1024 * 1024) continue;
    let buf;
    try {
      buf = await fs.readFile(full);
    } catch {
      continue;
    }
    if (buf.includes(0)) continue;
    const text = buf.toString("utf8");
    if (!text.includes(oldPrefix)) continue;
    await fs.writeFile(full, text.split(oldPrefix).join(newPrefix), "utf8");
  }
}
async function fixStaleCondaShebangsIfNeeded(onStatus) {
  if (process.platform !== "darwin") return;
  const envPrefix = getDefaultRuntimePrefix();
  if (!await fileExists(envPrefix)) return;
  const legacyPrefix = path.join(electron.app.getPath("userData"), "mamba-env");
  if (legacyPrefix === envPrefix) return;
  const probe = path.join(envPrefix, "bin", "propka3");
  if (!await fileExists(probe)) return;
  let firstLine = "";
  try {
    firstLine = (await fs.readFile(probe, "utf8")).split("\n")[0] || "";
  } catch {
    return;
  }
  if (!firstLine.includes(legacyPrefix)) return;
  onStatus("Updating conda environment paths after data folder move…");
  await rewriteCondaPrefixInTree(envPrefix, legacyPrefix, envPrefix);
}
function getDefaultRuntimePrefix() {
  return path.join(getGatewizardDataRoot(), "mamba-env");
}
function getMicromambaBinPath() {
  return path.join(
    getGatewizardDataRoot(),
    "micromamba",
    MICROMAMBA_TAG,
    process.platform === "win32" ? "micromamba.exe" : "micromamba"
  );
}
function getMambaRoot() {
  return path.join(getGatewizardDataRoot(), "mamba-root");
}
const OPENMM_CONDA_REV = "1";
function getCondaOpenmmGpuPackages() {
  if (process.platform === "win32") return [];
  if (process.platform === "darwin") return ["openmm"];
  return ["openmm", "cudatoolkit"];
}
function getCondaPackages() {
  const pkgs = [`python=${PYTHON_SPEC}`, "pip", "openssl"];
  if (process.platform !== "win32") {
    pkgs.push("ambertools", "git");
  }
  pkgs.push(...getCondaOpenmmGpuPackages());
  return pkgs;
}
function getRuntimeInstallLogPath() {
  return path.join(getGatewizardDataRoot(), "runtime-install.log");
}
async function appendRuntimeLog(text) {
  const logPath = getRuntimeInstallLogPath();
  await fs.appendFile(logPath, text, "utf-8");
}
function getSubprocessOptions(runtimePrefix, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  if (runtimePrefix) {
    env.CONDA_PREFIX = runtimePrefix;
  }
  delete env.PYTHONPATH;
  delete env.PYTHONHOME;
  delete env.PYTHONUSERBASE;
  return {
    encoding: "utf-8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env
  };
}
function attachOutputLogging(child) {
  child.stdout?.on("data", (chunk) => {
    void appendRuntimeLog(chunk.toString());
  });
  child.stderr?.on("data", (chunk) => {
    void appendRuntimeLog(chunk.toString());
  });
}
function probePythonSsl(pyPath, runtimePrefix) {
  const result = child_process.spawnSync(
    pyPath,
    ["-c", "import ssl; print(ssl.OPENSSL_VERSION)"],
    getSubprocessOptions(runtimePrefix)
  );
  const combined = `${result.stdout || ""}${result.stderr || ""}`;
  return result.status === 0 && String(result.stdout || "").trim().length > 0 && !combined.includes("SSL module is not available") && !combined.includes("not a mach-o file");
}
async function removeCorruptedRuntime(onStatus) {
  const envPath = getDefaultRuntimePrefix();
  const statePath = getStatePath();
  onStatus("Removing corrupted Python environment (will reinstall on next step)…");
  await appendRuntimeLog(`
[repair] Removing corrupted runtime at ${envPath}
`);
  await fs.rm(envPath, { recursive: true, force: true });
  await fs.rm(statePath, { force: true });
  cachedLaunchPython = null;
}
async function ensurePythonSsl(pyPath, runtimePrefix, micromambaDest, mmEnv, onStatus) {
  if (probePythonSsl(pyPath, runtimePrefix)) return true;
  await appendRuntimeLog("\n[ssl] Python SSL probe failed; attempting conda openssl repair\n");
  onStatus("Repairing Python SSL (OpenSSL)…");
  try {
    await runProcess(
      micromambaDest,
      ["install", "-p", runtimePrefix, "-c", "conda-forge", "openssl", "-y"],
      { env: mmEnv }
    );
  } catch (err) {
    await appendRuntimeLog(`[ssl] openssl conda install failed: ${err.message}
`);
  }
  if (probePythonSsl(pyPath, runtimePrefix)) return true;
  await removeCorruptedRuntime(onStatus);
  return false;
}
function formatPipSslHint(output) {
  if (!output.includes("SSL module is not available") && !output.includes("ssl support is missing")) {
    return "";
  }
  const root = getGatewizardDataRoot();
  return `

Python SSL/OpenSSL in the embedded environment is broken (often after a bad migration or iCloud sync of ~/Library/gatewizard-gui).
Quit GateWizard, then run: rm -rf "${root}/mamba-env" and relaunch the app.
If it persists, exclude ~/Library/gatewizard-gui from iCloud Desktop & Documents sync.`;
}
async function runPip(pyPath, pipArgs, runtimePrefix, options) {
  const { label, required = true } = options;
  const stamp = (/* @__PURE__ */ new Date()).toISOString();
  await appendRuntimeLog(`
[${stamp}] ${label}
> pip ${pipArgs.join(" ")}
`);
  const result = child_process.spawnSync(pyPath, ["-m", "pip", ...pipArgs], getSubprocessOptions(runtimePrefix));
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (output) {
    await appendRuntimeLog(output);
  }
  if (result.status !== 0) {
    const logPath = getRuntimeInstallLogPath();
    const tail = output.trim().slice(-3e3);
    const sslHint = formatPipSslHint(output);
    const message = `${label} failed.
Log: ${logPath}${tail ? `

${tail}` : ""}${sslHint}`;
    if (required) {
      throw new Error(message);
    }
    await appendRuntimeLog(`[warning] ${message}
`);
    return false;
  }
  return true;
}
function getOrientationRequirementsPath(requirementsPath) {
  return path.join(path.dirname(requirementsPath), "requirements-orientation.txt");
}
async function installOptionalOrientationRequirements(pyPath, requirementsPath, runtimePrefix, onStatus) {
  if (process.platform === "win32") {
    onStatus("Skipping MemPrO (optional; use WSL/Linux for orientation).");
    return;
  }
  const orientPath = getOrientationRequirementsPath(requirementsPath);
  if (!await fileExists(orientPath)) {
    return;
  }
  onStatus("Installing optional MemPrO (orientation)...");
  const ok = await runPip(
    pyPath,
    ["install", "-r", orientPath],
    runtimePrefix,
    { label: "pip install -r requirements-orientation.txt (optional)", required: false }
  );
  if (ok) {
    onStatus("MemPrO installed (orientation features available).");
  } else {
    onStatus("MemPrO install failed — orientation features disabled. See runtime-install.log.");
  }
}
async function ensureMicromambaBinary(onStatus) {
  const key = getMicromambaKey();
  if (!key || !MICROMAMBA_URL[key]) {
    throw new Error(
      `This platform (${process.platform} ${process.arch}) has no micromamba URL. Set GATEWIZARD_RUNTIME_PREFIX or GATEWIZARD_PYTHON.`
    );
  }
  const micromambaDest = getMicromambaBinPath();
  await fs.mkdir(path.dirname(micromambaDest), { recursive: true });
  if (!await fileExists(micromambaDest)) {
    onStatus(`Downloading micromamba ${MICROMAMBA_TAG}...`);
    await downloadFile(MICROMAMBA_URL[key], micromambaDest);
    if (process.platform !== "win32") {
      await fs.chmod(micromambaDest, 493);
    }
  }
  return micromambaDest;
}
async function installCondaOpenmmGpu(micromambaDest, runtimePrefix, mmEnv, onStatus) {
  const gpuPkgs = getCondaOpenmmGpuPackages();
  if (!gpuPkgs.length) return;
  onStatus(`Ensuring OpenMM via conda (${gpuPkgs.join(", ")})...`);
  await runProcess(
    micromambaDest,
    ["install", "-p", runtimePrefix, "-c", "conda-forge", ...gpuPkgs, "-y"],
    { env: mmEnv }
  );
}
async function syncCondaOpenmmGpuIfNeeded({
  micromambaDest,
  runtimePrefix,
  mmEnv,
  onStatus,
  state,
  statePath,
  extraState = {}
}) {
  if (process.platform === "win32") return state;
  if (state.openmmCondaRev === OPENMM_CONDA_REV) return state;
  await installCondaOpenmmGpu(micromambaDest, runtimePrefix, mmEnv, onStatus);
  const nextState = { ...state, ...extraState, openmmCondaRev: OPENMM_CONDA_REV };
  await fs.writeFile(statePath, JSON.stringify(nextState, null, 2), "utf-8");
  return nextState;
}
async function restoreCondaOpenmmAfterPip(micromambaDest, runtimePrefix, mmEnv, onStatus) {
  if (process.platform === "win32") return;
  await installCondaOpenmmGpu(micromambaDest, runtimePrefix, mmEnv, onStatus);
}
function getStatePath() {
  return path.join(getGatewizardDataRoot(), "runtime-state.json");
}
function getWindowsPythonCandidates(prefix) {
  return [
    path.join(prefix, "python.exe"),
    path.join(prefix, "Scripts", "python.exe"),
    path.join(prefix, "Library", "bin", "python.exe")
  ];
}
async function findPythonInPrefix(prefix) {
  if (process.platform === "win32") {
    for (const candidate of getWindowsPythonCandidates(prefix)) {
      if (await fileExists(candidate)) return candidate;
    }
    return null;
  }
  for (const name of ["python3", "python"]) {
    const p = path.join(prefix, "bin", name);
    if (await fileExists(p)) return p;
  }
  return null;
}
function inferCondaPrefixFromPython(pythonPath) {
  const resolved = path.resolve(pythonPath);
  const dir = path.dirname(resolved);
  const base = path.basename(dir);
  if (base === "bin" || base === "Scripts") {
    return path.dirname(dir);
  }
  if (process.platform === "win32" && path.basename(resolved).toLowerCase() === "python.exe") {
    return dir;
  }
  return null;
}
async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
async function sha256String(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}
async function downloadFile(url2, destPath) {
  const response = await fetch(url2);
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status} for ${url2}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(destPath, buffer);
}
function runProcess(command, args, options = {}) {
  const env = { ...process.env, ...options.env || {} };
  const runtimePrefix = env.CONDA_PREFIX || "";
  return new Promise((resolve, reject) => {
    const child = child_process.spawn(command, args, getSubprocessOptions(runtimePrefix, env));
    attachOutputLogging(child);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} exited with code ${code}`));
    });
    child.on("error", reject);
  });
}
function parseVcsRequirements(requirementsText) {
  return requirementsText.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")).filter((line) => line.includes(" @ git+"));
}
function forceReinstallVcsRequirements(pyPath, requirementsText, runtimePrefix) {
  const vcsReqs = parseVcsRequirements(requirementsText);
  if (vcsReqs.length === 0) return;
  for (const req of vcsReqs) {
    const pipVcs = child_process.spawnSync(
      pyPath,
      ["-m", "pip", "install", "--force-reinstall", "--no-deps", req],
      getSubprocessOptions(runtimePrefix)
    );
    if (pipVcs.status !== 0) {
      throw new Error(`pip force reinstall failed for VCS requirement: ${req}`);
    }
  }
}
async function ensureMambaRuntime(options) {
  const onStatus = options.onStatus || (() => {
  });
  const requirementsPath = options.requirementsPath;
  await migrateDarwinDataRootIfNeeded();
  await fixStaleCondaShebangsIfNeeded(onStatus);
  if (process.env.GATEWIZARD_PYTHON) {
    cachedLaunchPython = process.env.GATEWIZARD_PYTHON;
    const inferred = inferCondaPrefixFromPython(cachedLaunchPython);
    if (inferred) {
      process.env.CONDA_PREFIX = inferred;
    }
    onStatus(`Using GATEWIZARD_PYTHON: ${cachedLaunchPython}`);
    return;
  }
  if (process.env.GATEWIZARD_RUNTIME_PREFIX) {
    const prefix = path.resolve(process.env.GATEWIZARD_RUNTIME_PREFIX);
    const py = await findPythonInPrefix(prefix);
    if (!py) {
      throw new Error(`GATEWIZARD_RUNTIME_PREFIX: no Python found under ${prefix}`);
    }
    cachedLaunchPython = py;
    process.env.CONDA_PREFIX = prefix;
    onStatus(`Using GATEWIZARD_RUNTIME_PREFIX: ${prefix}`);
    return;
  }
  const requirementsText = await fs.readFile(requirementsPath, "utf-8");
  const requirementsHash = await sha256String(requirementsText);
  const key = getMicromambaKey();
  if (!key || !MICROMAMBA_URL[key]) {
    throw new Error(
      `This platform (${process.platform} ${process.arch}) has no micromamba URL. Set GATEWIZARD_RUNTIME_PREFIX or GATEWIZARD_PYTHON.`
    );
  }
  const runtimePrefix = getDefaultRuntimePrefix();
  const statePath = getStatePath();
  let state = {};
  if (await fileExists(statePath)) {
    try {
      state = JSON.parse(await fs.readFile(statePath, "utf-8"));
    } catch {
      state = {};
    }
  }
  const mambaRoot = getMambaRoot();
  const mmEnv = {
    ...process.env,
    MAMBA_ROOT_PREFIX: mambaRoot
  };
  let pyPath = await findPythonInPrefix(runtimePrefix);
  if (pyPath) {
    const micromambaDest2 = await ensureMicromambaBinary(onStatus);
    const sslOk = await ensurePythonSsl(pyPath, runtimePrefix, micromambaDest2, mmEnv, onStatus);
    if (!sslOk) {
      pyPath = null;
      state = {};
    }
  }
  const condaOk = pyPath && state.python === PYTHON_SPEC && state.micromambaTag === MICROMAMBA_TAG;
  const envReady = condaOk && state.requirementsHash === requirementsHash;
  if (envReady) {
    if (process.platform !== "win32" && state.openmmCondaRev !== OPENMM_CONDA_REV) {
      const micromambaDest2 = await ensureMicromambaBinary(onStatus);
      state = await syncCondaOpenmmGpuIfNeeded({
        micromambaDest: micromambaDest2,
        runtimePrefix,
        mmEnv,
        onStatus,
        state,
        statePath
      });
    }
    cachedLaunchPython = pyPath;
    process.env.CONDA_PREFIX = runtimePrefix;
    onStatus(`Runtime ready (cached): ${runtimePrefix}`);
    return;
  }
  if (condaOk && state.requirementsHash !== requirementsHash) {
    onStatus("Updating pip dependencies (requirements.txt changed)...");
    await runPip(
      pyPath,
      ["install", "--upgrade", "pip", "setuptools", "wheel"],
      runtimePrefix,
      { label: "pip upgrade (tools)" }
    );
    await runPip(
      pyPath,
      ["install", "-r", requirementsPath],
      runtimePrefix,
      { label: "pip install -r requirements.txt" }
    );
    forceReinstallVcsRequirements(pyPath, requirementsText, runtimePrefix);
    await installOptionalOrientationRequirements(pyPath, requirementsPath, runtimePrefix, onStatus);
    const micromambaDest2 = await ensureMicromambaBinary(onStatus);
    await restoreCondaOpenmmAfterPip(micromambaDest2, runtimePrefix, mmEnv, onStatus);
    state = await syncCondaOpenmmGpuIfNeeded({
      micromambaDest: micromambaDest2,
      runtimePrefix,
      mmEnv,
      onStatus,
      state,
      statePath,
      extraState: {
        python: PYTHON_SPEC,
        micromambaTag: MICROMAMBA_TAG,
        requirementsHash,
        runtimePrefix
      }
    });
    cachedLaunchPython = pyPath;
    process.env.CONDA_PREFIX = runtimePrefix;
    onStatus(`Runtime ready: ${runtimePrefix}`);
    return;
  }
  onStatus("Installing runtime (micromamba: Python + pip). First run may take several minutes.");
  if (process.platform === "win32") {
    onStatus(
      "Note: AmberTools (tleap, antechamber) is not installed on native Windows — use WSL for membrane building."
    );
  } else if (getCondaOpenmmGpuPackages().includes("cudatoolkit")) {
    onStatus("Linux/WSL: installing openmm + cudatoolkit from conda-forge for OpenMM CUDA support.");
  }
  const micromambaDest = await ensureMicromambaBinary(onStatus);
  await fs.mkdir(mambaRoot, { recursive: true });
  const condaPkgs = getCondaPackages();
  if (!await fileExists(runtimePrefix)) {
    onStatus(`Creating environment: ${condaPkgs.join(", ")}...`);
    await runProcess(
      micromambaDest,
      ["create", "-p", runtimePrefix, "-c", "conda-forge", ...condaPkgs, "-y"],
      { env: mmEnv }
    );
  } else {
    onStatus("Updating Python in existing environment...");
    await runProcess(
      micromambaDest,
      ["install", "-p", runtimePrefix, "-c", "conda-forge", ...condaPkgs, "-y"],
      { env: mmEnv }
    );
  }
  const pyResolved = await findPythonInPrefix(runtimePrefix);
  if (!pyResolved) {
    throw new Error(`Python missing after install under ${runtimePrefix}`);
  }
  onStatus("pip install -r backend/requirements.txt ...");
  await runPip(
    pyResolved,
    ["install", "--upgrade", "pip", "setuptools", "wheel"],
    runtimePrefix,
    { label: "pip upgrade (tools)" }
  );
  await runPip(
    pyResolved,
    ["install", "-r", requirementsPath],
    runtimePrefix,
    { label: "pip install -r requirements.txt" }
  );
  forceReinstallVcsRequirements(pyResolved, requirementsText, runtimePrefix);
  await installOptionalOrientationRequirements(
    pyResolved,
    requirementsPath,
    runtimePrefix,
    onStatus
  );
  await restoreCondaOpenmmAfterPip(micromambaDest, runtimePrefix, mmEnv, onStatus);
  await fs.writeFile(
    statePath,
    JSON.stringify(
      {
        python: PYTHON_SPEC,
        micromambaTag: MICROMAMBA_TAG,
        requirementsHash,
        runtimePrefix,
        openmmCondaRev: OPENMM_CONDA_REV
      },
      null,
      2
    ),
    "utf-8"
  );
  cachedLaunchPython = pyResolved;
  process.env.CONDA_PREFIX = runtimePrefix;
  onStatus(`Runtime ready: ${runtimePrefix}`);
}
function readGatewizardInstallSpec(requirementsText, overrideSpec) {
  if (overrideSpec?.trim()) return overrideSpec.trim();
  const vcsReqs = parseVcsRequirements(requirementsText).filter(
    (req) => req.toLowerCase().startsWith("gatewizard")
  );
  if (vcsReqs.length > 0) return vcsReqs[0];
  const line = requirementsText.split(/\r?\n/).map((row) => row.trim()).find((row) => row && !row.startsWith("#") && row.toLowerCase().startsWith("gatewizard"));
  return line ?? null;
}
async function upgradeGatewizardPackage(options) {
  const onStatus = options.onStatus || (() => {
  });
  const requirementsPath = options.requirementsPath;
  const requirementsText = await fs.readFile(requirementsPath, "utf-8");
  const installSpec = readGatewizardInstallSpec(requirementsText, options.installSpec);
  if (!installSpec) {
    throw new Error("No gatewizard install spec found in requirements or manifest");
  }
  const pyPath = cachedLaunchPython;
  const runtimePrefix = process.env.CONDA_PREFIX || getDefaultRuntimePrefix();
  if (!pyPath) {
    throw new Error("Python runtime is not ready. Restart the app and try again.");
  }
  onStatus(`Upgrading gatewizard: ${installSpec}`);
  await runPip(
    pyPath,
    ["install", "--upgrade", "pip", "setuptools", "wheel"],
    runtimePrefix,
    { label: "pip upgrade (tools)" }
  );
  await runPip(
    pyPath,
    ["install", "--upgrade", "--force-reinstall", "--no-deps", installSpec],
    runtimePrefix,
    { label: `pip install ${installSpec}` }
  );
  await runPip(
    pyPath,
    ["install", "-r", requirementsPath],
    runtimePrefix,
    { label: "pip install -r requirements.txt (after gatewizard upgrade)" }
  );
  forceReinstallVcsRequirements(pyPath, requirementsText, runtimePrefix);
  await installOptionalOrientationRequirements(pyPath, requirementsPath, runtimePrefix, onStatus);
  if (process.platform !== "win32") {
    try {
      const onStatus2 = options.onStatus || (() => {
      });
      const micromambaDest = await ensureMicromambaBinary(onStatus2);
      const mmEnv = {
        ...process.env,
        MAMBA_ROOT_PREFIX: getMambaRoot()
      };
      await restoreCondaOpenmmAfterPip(micromambaDest, runtimePrefix, mmEnv, onStatus2);
    } catch (err) {
      onStatus(`Note: could not refresh conda OpenMM packages: ${err.message}`);
    }
  }
  const versionProbe = child_process.spawnSync(
    pyPath,
    ["-c", 'from importlib import metadata; print(metadata.version("gatewizard"))'],
    getSubprocessOptions(runtimePrefix)
  );
  const gatewizardVersion = versionProbe.status === 0 ? String(versionProbe.stdout).trim() || null : null;
  onStatus(
    gatewizardVersion ? `gatewizard upgraded to ${gatewizardVersion}` : "gatewizard upgrade finished"
  );
  return { gatewizardVersion, installSpec };
}
function getLaunchPythonPath() {
  if (cachedLaunchPython) {
    return cachedLaunchPython;
  }
  if (process.env.GATEWIZARD_PYTHON) {
    return process.env.GATEWIZARD_PYTHON;
  }
  const prefix = process.env.GATEWIZARD_RUNTIME_PREFIX;
  if (prefix) {
    if (process.platform === "win32") {
      return path.join(path.resolve(prefix), "Scripts", "python.exe");
    }
    return path.join(path.resolve(prefix), "bin", "python3");
  }
  return process.platform === "win32" ? "python" : "python3";
}
const DEFAULT_MANIFEST_URL = "https://raw.githubusercontent.com/maurobedoya/gatewizard/main/releases/gui-versions.json";
function getManifestUrl() {
  return process.env.GATEWIZARD_UPDATE_MANIFEST_URL || DEFAULT_MANIFEST_URL;
}
function parseSemver(version) {
  if (!version) return null;
  const match = String(version).trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
function compareSemver(a, b) {
  const av = parseSemver(a);
  const bv = parseSemver(b);
  if (!av && !bv) return 0;
  if (!av) return -1;
  if (!bv) return 1;
  for (let i = 0; i < 3; i += 1) {
    if (av[i] !== bv[i]) return av[i] - bv[i];
  }
  return 0;
}
function pickGuiDownloadUrl(platform, downloads = {}) {
  if (!downloads) return null;
  const linuxDeb = downloads.linux_deb ?? downloads.linux ?? downloads.linux_appimage ?? null;
  if (platform === "win32") return linuxDeb;
  if (platform === "darwin") {
    return process.arch === "arm64" ? downloads.mac_arm64 ?? downloads.mac ?? null : downloads.mac_x64 ?? downloads.mac ?? null;
  }
  if (platform === "linux") return linuxDeb;
  return linuxDeb ?? downloads.mac ?? null;
}
async function checkForUpdates(options) {
  const manifestUrl = options.manifestUrl || getManifestUrl();
  const result = {
    ok: false,
    manifestUrl,
    local: {
      gui: options.guiVersion,
      gatewizard: options.gatewizardVersion
    },
    remote: {
      gui: null,
      gatewizard: null,
      min_gatewizard: null
    },
    gui: {
      updateAvailable: false,
      downloadUrl: null,
      releasePage: null
    },
    gatewizard: {
      updateAvailable: false,
      installSpec: null
    },
    notes: null,
    error: null
  };
  let manifest;
  try {
    const response = await fetch(manifestUrl, {
      headers: { Accept: "application/json", "User-Agent": "gatewizard-gui" }
    });
    if (!response.ok) {
      throw new Error(`Manifest HTTP ${response.status}`);
    }
    manifest = await response.json();
  } catch (error) {
    result.error = error instanceof Error ? error.message : "Failed to fetch update manifest";
    return result;
  }
  result.ok = true;
  result.remote.gui = manifest.gui?.latest ?? null;
  result.remote.gatewizard = manifest.gatewizard?.latest ?? null;
  result.remote.min_gatewizard = manifest.gui?.min_gatewizard ?? manifest.gatewizard?.min_for_gui ?? null;
  result.notes = manifest.notes ?? null;
  if (manifest.gui?.latest && compareSemver(options.guiVersion, manifest.gui.latest) < 0) {
    result.gui.updateAvailable = true;
    result.gui.releasePage = manifest.gui.release_page ?? null;
    result.gui.downloadUrl = pickGuiDownloadUrl(process.platform, manifest.gui.downloads);
  }
  const remoteApi = manifest.gatewizard?.latest;
  const localApi = options.gatewizardVersion;
  if (remoteApi && localApi && compareSemver(localApi, remoteApi) < 0) {
    result.gatewizard.updateAvailable = true;
    result.gatewizard.installSpec = manifest.gatewizard?.install ?? null;
  } else if (remoteApi && !localApi) {
    result.gatewizard.updateAvailable = true;
    result.gatewizard.installSpec = manifest.gatewizard?.install ?? null;
  }
  if (result.remote.min_gatewizard && localApi && compareSemver(localApi, result.remote.min_gatewizard) < 0 && !result.gatewizard.updateAvailable) {
    result.gatewizard.updateAvailable = true;
    result.gatewizard.installSpec = manifest.gatewizard?.install ?? null;
  }
  return result;
}
function getLocalGuiVersion() {
  return electron.app.getVersion();
}
const MIN_WINDOW_WIDTH$1 = 640;
const MIN_WINDOW_HEIGHT$1 = 480;
function getDisplayForWindow(win) {
  const bounds = win.getBounds();
  return electron.screen.getDisplayNearestPoint({
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2)
  });
}
function getWorkAreaMaximizeBounds(win) {
  const display = getDisplayForWindow(win);
  const { bounds, workArea, scaleFactor } = display;
  const sf = scaleFactor || 1;
  let x = workArea.x;
  let y = workArea.y;
  let width = workArea.width;
  let height = workArea.height;
  const gapBottom = bounds.y + bounds.height - (workArea.y + workArea.height);
  const gapTop = workArea.y - bounds.y;
  const taskbarReserve = Math.round(48 * sf);
  if (gapBottom < Math.round(4 * sf)) {
    if (gapTop > Math.round(4 * sf)) {
      y += taskbarReserve;
      height = Math.max(MIN_WINDOW_HEIGHT$1, height - taskbarReserve);
    } else {
      height = Math.max(MIN_WINDOW_HEIGHT$1, height - taskbarReserve);
    }
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(MIN_WINDOW_WIDTH$1, Math.round(width)),
    height: Math.max(MIN_WINDOW_HEIGHT$1, Math.round(height))
  };
}
function applyWorkAreaMaximize(win) {
  const bounds = getWorkAreaMaximizeBounds(win);
  win.setMaximumSize(bounds.width, bounds.height);
  win.setBounds(bounds);
}
function clearWorkAreaMaximizeLimits(win) {
  win.setMaximumSize(0, 0);
}
function mergePathSegments(...segments) {
  const seen = /* @__PURE__ */ new Set();
  const parts = [];
  for (const segment of segments) {
    if (!segment) continue;
    for (const part of segment.split(path.delimiter)) {
      const trimmed = part.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      parts.push(trimmed);
    }
  }
  return parts.join(path.delimiter);
}
function getWindowsRegistryPath() {
  try {
    const result = child_process.spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "[Environment]::GetEnvironmentVariable('Path','User') + ';' + [Environment]::GetEnvironmentVariable('Path','Machine')"
      ],
      { encoding: "utf-8", windowsHide: true, timeout: 8e3 }
    );
    if (result.status === 0 && result.stdout?.trim()) {
      return result.stdout.trim();
    }
  } catch {
  }
  return "";
}
function getUnixLoginPath() {
  const shell = process.env.SHELL || "/bin/bash";
  const isFish = shell.toLowerCase().includes("fish");
  const args = isFish ? ["-l", "-c", "echo -n $PATH"] : ["-l", "-i", "-c", "echo -n $PATH"];
  try {
    const result = child_process.spawnSync(shell, args, {
      encoding: "utf-8",
      timeout: 1e4,
      env: { ...process.env, TERM: "dumb" }
    });
    if (result.status === 0 && result.stdout) {
      return result.stdout.trim();
    }
  } catch {
  }
  return "";
}
function getLoginShellPath() {
  if (process.platform === "win32") {
    return getWindowsRegistryPath();
  }
  if (process.platform === "linux" || process.platform === "darwin") {
    return getUnixLoginPath();
  }
  return process.env.PATH || "";
}
function buildAugmentedPath(currentPath = process.env.PATH || "", prefixDirs = "") {
  const loginPath = getLoginShellPath();
  return mergePathSegments(prefixDirs, loginPath, currentPath);
}
const BACKEND_URL = "http://127.0.0.1:8765";
const GPU_SAFE_MODE_FLAG = "--gatewizard-gpu-safe-mode=1";
const GPU_RELAUNCHED_FLAG = "--gatewizard-gpu-relaunched=1";
const SPLASH_MIN_MS = 3200;
const SPLASH_FADE_MS = 350;
const SPLASH_WIDTH = 360;
const SPLASH_HEIGHT = 420;
const SPLASH_LINUX_SIZE = 440;
function getSplashWindowSize() {
  if (process.platform === "linux") {
    return { width: SPLASH_LINUX_SIZE, height: SPLASH_LINUX_SIZE };
  }
  return { width: SPLASH_WIDTH, height: SPLASH_HEIGHT };
}
let backendProcess = null;
let mainWindow = null;
let splashWindow = null;
let splashShownAt = 0;
let splashClosing = false;
let activeResize = null;
const MIN_WINDOW_WIDTH = 640;
const MIN_WINDOW_HEIGHT = 480;
const workAreaWindowStates = /* @__PURE__ */ new WeakMap();
function usesWorkAreaMaximize() {
  return process.platform === "linux" || process.platform === "win32";
}
function getWorkAreaWindowState(win) {
  let state = workAreaWindowStates.get(win);
  if (!state) {
    state = { maximized: false, applyingBounds: false, blockNativeMaximize: false };
    workAreaWindowStates.set(win, state);
  }
  return state;
}
function setupWorkAreaFramelessWindow(win) {
  if (!usesWorkAreaMaximize()) return;
  win.on("will-resize", () => {
    const state = getWorkAreaWindowState(win);
    if (!state.applyingBounds) state.maximized = false;
  });
  win.on("maximize", () => {
    const state = getWorkAreaWindowState(win);
    if (state.applyingBounds || state.blockNativeMaximize) return;
    state.blockNativeMaximize = true;
    try {
      if (!win.isDestroyed() && win.isMaximized()) win.unmaximize();
      if (!state.maximized) {
        state.restoreBounds = win.getNormalBounds();
        state.applyingBounds = true;
        applyWorkAreaMaximize(win);
        state.maximized = true;
        state.applyingBounds = false;
        sendWindowChromeStyle(win);
      }
    } finally {
      state.blockNativeMaximize = false;
    }
  });
  if (process.platform === "win32") {
    electron.screen.on("display-metrics-changed", () => {
      const state = getWorkAreaWindowState(win);
      if (win.isDestroyed() || !state.maximized) return;
      state.applyingBounds = true;
      try {
        applyWorkAreaMaximize(win);
      } finally {
        state.applyingBounds = false;
      }
    });
  }
}
function toggleWorkAreaMaximize(win) {
  const state = getWorkAreaWindowState(win);
  if (state.maximized) {
    state.applyingBounds = true;
    try {
      clearWorkAreaMaximizeLimits(win);
      if (state.restoreBounds) win.setBounds(state.restoreBounds);
      state.maximized = false;
    } finally {
      state.applyingBounds = false;
      if (!win.isDestroyed()) {
        win.webContents.send("window:bounds-changed");
        sendWindowChromeStyle(win);
      }
    }
    return;
  }
  state.restoreBounds = win.getNormalBounds();
  state.applyingBounds = true;
  try {
    applyWorkAreaMaximize(win);
    state.maximized = true;
  } finally {
    state.applyingBounds = false;
    if (!win.isDestroyed()) {
      win.webContents.send("window:bounds-changed");
      sendWindowChromeStyle(win);
    }
  }
}
function sendWindowChromeStyle(win) {
  if (process.platform !== "win32" || win.isDestroyed()) return;
  const state = getWorkAreaWindowState(win);
  const maximized = state.maximized || win.isMaximized() || win.isFullScreen();
  win.webContents.send("window:chrome-style", maximized ? "maximized" : "normal");
}
function attachWindowStateHandlers(win) {
  const notify = () => {
    if (!win.isDestroyed()) win.webContents.send("window:bounds-changed");
  };
  win.on("maximize", () => {
    notify();
    sendWindowChromeStyle(win);
  });
  win.on("unmaximize", () => {
    notify();
    sendWindowChromeStyle(win);
  });
  win.on("restore", () => {
    notify();
    sendWindowChromeStyle(win);
  });
  win.on("resize", notify);
  win.on("ready-to-show", () => sendWindowChromeStyle(win));
}
function registerWindowResizeIpc() {
  electron.ipcMain.on("window:resize-start", (event, edge) => {
    const win = electron.BrowserWindow.fromWebContents(event.sender);
    if (!win || typeof edge !== "string") return;
    if (usesWorkAreaMaximize()) {
      const state = getWorkAreaWindowState(win);
      if (state.maximized) {
        clearWorkAreaMaximizeLimits(win);
        if (state.restoreBounds) win.setBounds(state.restoreBounds);
        state.maximized = false;
        sendWindowChromeStyle(win);
      }
    } else if (win.isMaximized()) {
      win.unmaximize();
    }
    activeResize = {
      win,
      edge,
      startBounds: win.getBounds(),
      startPoint: electron.screen.getCursorScreenPoint()
    };
  });
  electron.ipcMain.on("window:resize-move", () => {
    if (!activeResize) return;
    const { win, edge, startBounds, startPoint } = activeResize;
    if (win.isDestroyed()) {
      activeResize = null;
      return;
    }
    const point = electron.screen.getCursorScreenPoint();
    const dx = point.x - startPoint.x;
    const dy = point.y - startPoint.y;
    let { x, y, width, height } = startBounds;
    if (edge.includes("e")) width = Math.max(MIN_WINDOW_WIDTH, startBounds.width + dx);
    if (edge.includes("s")) height = Math.max(MIN_WINDOW_HEIGHT, startBounds.height + dy);
    if (edge.includes("w")) {
      const nextWidth = Math.max(MIN_WINDOW_WIDTH, startBounds.width - dx);
      x = startBounds.x + (startBounds.width - nextWidth);
      width = nextWidth;
    }
    if (edge.includes("n")) {
      const nextHeight = Math.max(MIN_WINDOW_HEIGHT, startBounds.height - dy);
      y = startBounds.y + (startBounds.height - nextHeight);
      height = nextHeight;
    }
    win.setBounds({ x, y, width, height });
  });
  electron.ipcMain.on("window:resize-end", () => {
    activeResize = null;
  });
}
function registerWindowControlsIpc() {
  electron.ipcMain.on("win:invoke", (event, action) => {
    const win = electron.BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (action === "show") {
      win.show();
    } else if (action === "showInactive") {
      win.showInactive();
    } else if (action === "min") {
      win.minimize();
    } else if (action === "max") {
      if (usesWorkAreaMaximize()) {
        toggleWorkAreaMaximize(win);
      } else if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    } else if (action === "close") {
      win.close();
    }
  });
}
function getResourcesDir() {
  if (electron.app.isPackaged) {
    return path.join(process.resourcesPath, "app.asar.unpacked", "resources");
  }
  return path.join(electron.app.getAppPath(), "resources");
}
function keepSplashOnTop() {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  if (process.platform === "linux") {
    splashWindow.setAlwaysOnTop(true);
  } else {
    splashWindow.setAlwaysOnTop(true, "screen-saver");
  }
}
function setSplashStatus(message, busy = true) {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  const safeMessage = JSON.stringify(message);
  const busyFlag = busy ? "true" : "false";
  splashWindow.webContents.executeJavaScript(`window.setSplashStatus(${safeMessage}, ${busyFlag})`).catch(() => {
  });
}
function createSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    return splashWindow;
  }
  const { width, height } = getSplashWindowSize();
  splashWindow = new electron.BrowserWindow({
    width,
    height,
    frame: false,
    transparent: true,
    center: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  splashWindow.loadFile(path.join(getResourcesDir(), "splash.html"));
  splashWindow.once("ready-to-show", () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashShownAt = Date.now();
      keepSplashOnTop();
      splashWindow.show();
    }
  });
  return splashWindow;
}
function isSplashActive() {
  return splashWindow != null && !splashWindow.isDestroyed();
}
function revealMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed() || isSplashActive()) return;
  if (!mainWindow.isVisible()) mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}
function closeSplashWindowImmediate() {
  splashClosing = false;
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  splashWindow = null;
}
async function closeSplashWindowWhenReady() {
  if (splashClosing || !splashWindow || splashWindow.isDestroyed()) return;
  splashClosing = true;
  const remaining = Math.max(0, SPLASH_MIN_MS - (Date.now() - splashShownAt));
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
  if (splashWindow && !splashWindow.isDestroyed()) {
    keepSplashOnTop();
    try {
      await splashWindow.webContents.executeJavaScript(
        "document.documentElement.classList.add('fade-out')"
      );
    } catch {
    }
    await new Promise((resolve) => setTimeout(resolve, SPLASH_FADE_MS));
  }
  closeSplashWindowImmediate();
}
function hasCliFlag(flag) {
  return process.argv.includes(flag);
}
function isGpuSafeModeEnabled() {
  return hasCliFlag(GPU_SAFE_MODE_FLAG) || process.env.GATEWIZARD_GPU_SAFE_MODE === "1";
}
function hasRelaunchedForGpuFallback() {
  return hasCliFlag(GPU_RELAUNCHED_FLAG);
}
function applyGpuStartupMode() {
  if (!isGpuSafeModeEnabled()) return;
  electron.app.disableHardwareAcceleration();
  electron.app.commandLine.appendSwitch("use-angle", "swiftshader");
  electron.app.commandLine.appendSwitch("enable-unsafe-swiftshader");
}
function relaunchInGpuSafeMode(reason) {
  if (isGpuSafeModeEnabled() || hasRelaunchedForGpuFallback()) {
    process.stderr.write(`[gpu] GPU fallback already attempted, not relaunching again. reason=${reason}
`);
    return false;
  }
  const nextArgs = process.argv.slice(1);
  nextArgs.push(GPU_SAFE_MODE_FLAG, GPU_RELAUNCHED_FLAG);
  process.stderr.write(`[gpu] Relaunching in software mode. reason=${reason}
`);
  electron.app.relaunch({ args: nextArgs });
  electron.app.exit(0);
  return true;
}
applyGpuStartupMode();
if (process.platform === "linux" && !isGpuSafeModeEnabled()) {
  electron.app.commandLine.appendSwitch("ignore-gpu-blocklist");
  electron.app.commandLine.appendSwitch("enable-gpu-rasterization");
  electron.app.commandLine.appendSwitch("enable-zero-copy");
}
function getBackendScriptPath() {
  if (electron.app.isPackaged) {
    return path.join(process.resourcesPath, "backend", "app.py");
  }
  return path.join(electron.app.getAppPath(), "backend", "app.py");
}
function getRequirementsPath() {
  if (electron.app.isPackaged) {
    return path.join(process.resourcesPath, "backend", "requirements.txt");
  }
  return path.join(electron.app.getAppPath(), "backend", "requirements.txt");
}
async function waitForBackendHealth(timeoutMs = 12e4) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${BACKEND_URL}/health`);
      if (response.ok) {
        return;
      }
    } catch {
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `Python backend did not respond at ${BACKEND_URL}. Check logs or set GATEWIZARD_RUNTIME_PREFIX / GATEWIZARD_PYTHON.`
  );
}
function getBackendEnv() {
  const env = { ...process.env };
  let prefix = env.CONDA_PREFIX || process.env.CONDA_PREFIX;
  if (!prefix) {
    const inferred = inferCondaPrefixFromPython(getLaunchPythonPath());
    if (inferred) {
      prefix = inferred;
      env.CONDA_PREFIX = inferred;
    }
  }
  let prefixDirs = "";
  if (prefix) {
    env.CONDA_PREFIX = prefix;
    const binDir = process.platform === "win32" ? path.join(prefix, "Scripts") : path.join(prefix, "bin");
    prefixDirs = binDir;
    if (!env.AMBERHOME) {
      env.AMBERHOME = prefix;
    }
  }
  env.PATH = buildAugmentedPath(env.PATH, prefixDirs);
  env.GATEWIZARD_USER_DATA = getGatewizardDataRoot();
  return env;
}
function startBackend() {
  const pythonBin = getLaunchPythonPath();
  const backendScript = getBackendScriptPath();
  backendProcess = child_process.spawn(pythonBin, ["-u", backendScript], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    cwd: getGatewizardDataRoot(),
    env: getBackendEnv()
  });
  backendProcess.stdout?.on("data", (chunk) => {
    process.stdout.write(`[backend] ${chunk}`);
  });
  backendProcess.stderr?.on("data", (chunk) => {
    process.stderr.write(`[backend] ${chunk}`);
  });
  backendProcess.on("error", (err) => {
    process.stderr.write(`[backend] failed to spawn ${pythonBin}: ${err.message}
`);
  });
}
function stopBackend() {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
    backendProcess = null;
  }
}
async function restartBackend() {
  process.stdout.write("[backend] Restarting...\n");
  stopBackend();
  startBackend();
  try {
    await waitForBackendHealth();
    process.stdout.write("[backend] Restarted successfully\n");
  } catch (error) {
    process.stderr.write(`[backend] Failed to restart: ${error.message}
`);
  }
}
function watchBackendFiles() {
  const backendDir = path.join(electron.app.getAppPath(), "backend");
  let debounceTimer = null;
  fs$1.watch(backendDir, { recursive: true }, (_event, filename) => {
    if (!filename?.endsWith(".py")) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      process.stdout.write(`[backend] Detected change in ${filename}
`);
      restartBackend();
    }, 500);
  });
}
function applyMainWindowTheme(theme) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setBackgroundColor(theme === "light" ? "#fafafa" : "#0a0a0a");
  if (process.platform === "linux" || process.platform === "win32") {
    const iconPath = resolveAppWindowIconPath(theme);
    const image = electron.nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) mainWindow.setIcon(image);
  }
}
function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return mainWindow;
  }
  mainWindow = new electron.BrowserWindow({
    width: 900,
    height: 670,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    frame: false,
    // Custom renderer resize handles (see WindowResizeHandles.svelte). Native thickFrame
    // adds external hit bands with a second cursor and pointer jump on Windows.
    thickFrame: false,
    autoHideMenuBar: true,
    backgroundColor: "#0a0a0a",
    ...process.platform === "win32" ? { roundedCorners: true } : {},
    ...usesWorkAreaMaximize() ? { maximizable: false } : {},
    ...process.platform === "linux" || process.platform === "win32" ? { icon: appWindowIcon } : {},
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  });
  mainWindow.setMinimumSize(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT);
  setupWorkAreaFramelessWindow(mainWindow);
  attachWindowStateHandlers(mainWindow);
  mainWindow.on("ready-to-show", async () => {
    await closeSplashWindowWhenReady();
    revealMainWindow();
    if (isGpuSafeModeEnabled()) {
      electron.dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "Running In Compatibility Mode",
        message: "GateWizard detected GPU initialization issues and switched to software rendering.",
        detail: "3D visualization may be slower. Update GPU/WSL graphics drivers to restore full acceleration."
      });
    }
  });
  mainWindow.webContents.on("did-finish-load", () => {
    revealMainWindow();
    sendWindowChromeStyle(mainWindow);
  });
  const forceShowTimer = setTimeout(() => {
    revealMainWindow();
  }, 2e3);
  mainWindow.on("closed", () => {
    clearTimeout(forceShowTimer);
    mainWindow = null;
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, url2) => {
    process.stderr.write(
      `[renderer] failed to load ${url2} (${errorCode}): ${errorDescription}
`
    );
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    process.stderr.write(
      `[renderer] process gone: ${details.reason} (exitCode=${details.exitCode})
`
    );
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  return mainWindow;
}
electron.app.whenReady().then(async () => {
  utils.electronApp.setAppUserModelId("com.gatewizard.gui");
  createSplashWindow();
  await new Promise((resolve) => {
    if (!splashWindow || splashWindow.isDestroyed()) {
      resolve();
      return;
    }
    if (splashWindow.webContents.isLoading()) {
      splashWindow.webContents.once("did-finish-load", () => resolve());
    } else {
      resolve();
    }
  });
  registerWindowControlsIpc();
  registerWindowResizeIpc();
  electron.app.on("browser-window-created", (_, window) => {
    if (window === splashWindow) return;
    utils.optimizer.watchWindowShortcuts(window);
  });
  electron.ipcMain.on("ping", () => console.log("pong"));
  setSplashStatus("Preparing Python environment…\nFirst launch may take several minutes.");
  try {
    await ensureMambaRuntime({
      requirementsPath: getRequirementsPath(),
      onStatus: (msg) => {
        process.stdout.write(`[runtime] ${msg}
`);
        setSplashStatus(msg);
      }
    });
  } catch (error) {
    closeSplashWindowImmediate();
    await electron.dialog.showErrorBox("Runtime bootstrap failed", error.message);
    electron.app.quit();
    return;
  }
  setSplashStatus("Starting backend…");
  startBackend();
  try {
    await waitForBackendHealth();
  } catch (error) {
    closeSplashWindowImmediate();
    await electron.dialog.showErrorBox("Backend failed to start", error.message);
  }
  if (utils.is.dev) {
    watchBackendFiles();
  }
  createWindow();
  electron.app.on("activate", function() {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("child-process-gone", (_event, details) => {
  if (details.type !== "GPU") return;
  process.stderr.write(
    `[gpu] child process gone: reason=${details.reason} exitCode=${details.exitCode}
`
  );
  relaunchInGpuSafeMode(`child-process-gone:${details.reason}`);
});
electron.app.on("before-quit", () => {
  stopBackend();
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
electron.ipcMain.handle("dialog:openPdb", async () => {
  const win = electron.BrowserWindow.getFocusedWindow();
  const result = await electron.dialog.showOpenDialog(win ?? void 0, {
    title: "Open PDB",
    filters: [
      { name: "Structure", extensions: ["pdb", "ent", "cif", "mmcif"] },
      { name: "All files", extensions: ["*"] }
    ],
    properties: ["openFile"]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }
  return { canceled: false, filePath: result.filePaths[0] };
});
electron.ipcMain.handle(
  "dialog:openDirectory",
  async (_event, title = "Select Directory", defaultPath = void 0) => {
    const win = electron.BrowserWindow.getFocusedWindow();
    const result = await electron.dialog.showOpenDialog(win ?? void 0, {
      title,
      defaultPath,
      properties: ["openDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    return { canceled: false, dirPath: result.filePaths[0] };
  }
);
electron.ipcMain.handle("dialog:openLigandFile", async (_event, title, extensions) => {
  const win = electron.BrowserWindow.getFocusedWindow();
  const result = await electron.dialog.showOpenDialog(win ?? void 0, {
    title: title || "Open File",
    filters: [
      { name: "Ligand files", extensions: extensions || ["frcmod", "lib", "mol2"] },
      { name: "All files", extensions: ["*"] }
    ],
    properties: ["openFile"]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }
  return { canceled: false, filePath: result.filePaths[0] };
});
electron.ipcMain.handle("dialog:openFile", async (_event, title, filters, defaultPath = void 0) => {
  filters = filters || [];
  if (!filters.some((filter) => filter.name.toLowerCase() === "all files")) {
    filters.push({ name: "All files", extensions: ["*"] });
  }
  const win = electron.BrowserWindow.getFocusedWindow();
  const result = await electron.dialog.showOpenDialog(win ?? void 0, {
    title: title || "Open File",
    filters,
    defaultPath,
    properties: ["openFile"]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }
  return { canceled: false, filePath: result.filePaths[0] };
});
electron.ipcMain.handle("dialog:openFiles", async (_event, title, filters, defaultPath = void 0) => {
  filters = filters || [];
  if (!filters.some((filter) => filter.name.toLowerCase() === "all files")) {
    filters.push({ name: "All files", extensions: ["*"] });
  }
  const win = electron.BrowserWindow.getFocusedWindow();
  const result = await electron.dialog.showOpenDialog(win ?? void 0, {
    title: title || "Open Files",
    filters,
    defaultPath,
    properties: ["openFile", "multiSelections"]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true, filePaths: [] };
  }
  return { canceled: false, filePaths: result.filePaths };
});
electron.ipcMain.handle("fs:readJson", async (_event, filePath) => {
  const contents = await fs.readFile(filePath, "utf-8");
  return JSON.parse(contents);
});
electron.ipcMain.handle("dialog:saveFile", async (_event, title, filters, defaultPath = void 0) => {
  filters = filters || [];
  if (!filters.some((filter) => filter.name.toLowerCase() === "all files")) {
    filters.push({ name: "All files", extensions: ["*"] });
  }
  const win = electron.BrowserWindow.getFocusedWindow();
  const result = await electron.dialog.showSaveDialog(win ?? void 0, {
    title: title || "Save File",
    filters,
    defaultPath: defaultPath || void 0,
    properties: ["showOverwriteConfirmation", "createDirectory"]
  });
  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }
  let filePath = result.filePath;
  const primaryExt = filters[0]?.extensions?.find((e) => e !== "*");
  if (primaryExt && !filePath.toLowerCase().endsWith(`.${primaryExt.toLowerCase()}`)) {
    filePath = `${filePath}.${primaryExt}`;
  }
  return { canceled: false, filePath };
});
electron.ipcMain.handle("fs:writeJson", async (_event, filePath, data) => {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
});
electron.ipcMain.handle("fs:writeText", async (_event, filePath, text) => {
  await fs.writeFile(filePath, text, "utf-8");
});
electron.ipcMain.handle("fs:writeBinary", async (_event, filePath, base64) => {
  await fs.writeFile(filePath, Buffer.from(base64, "base64"));
});
async function fetchGatewizardVersion() {
  try {
    const response = await fetch(`${BACKEND_URL}/ping`);
    if (!response.ok) return null;
    const data = await response.json();
    return data.gatewizard_version ?? null;
  } catch {
    return null;
  }
}
electron.ipcMain.handle("updates:check", async () => {
  const gatewizardVersion = await fetchGatewizardVersion();
  return checkForUpdates({
    guiVersion: getLocalGuiVersion(),
    gatewizardVersion
  });
});
electron.ipcMain.handle("updates:get-manifest-url", async () => getManifestUrl());
electron.ipcMain.handle("updates:open-url", async (_event, url2) => {
  if (!url2 || typeof url2 !== "string") {
    throw new Error("URL is required");
  }
  await electron.shell.openExternal(url2);
});
electron.ipcMain.handle("runtime:upgrade-gatewizard", async (_event, installSpec) => {
  const result = await upgradeGatewizardPackage({
    requirementsPath: getRequirementsPath(),
    installSpec: typeof installSpec === "string" ? installSpec : void 0,
    onStatus: (msg) => process.stdout.write(`[runtime] ${msg}
`)
  });
  await restartBackend();
  return result;
});
electron.ipcMain.handle("theme:set", (_event, theme) => {
  if (theme !== "light" && theme !== "dark") return;
  applyMainWindowTheme(theme);
});
