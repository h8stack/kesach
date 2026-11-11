/**
 * electron-builder `beforeBuild` hook.
 *
 * electron-builder rebuilds every native module found in node_modules before
 * packaging. ssh2 (via ssh2-sftp-client) pulls in the optional `cpu-features`
 * module, whose install script is skipped or fails on clean installs, so the
 * rebuild aborts with "gyp: buildcheck.gypi not found".
 *
 * `cpu-features` is only a CPU-detection optimisation for ssh2, which works
 * without it. Remove the module so electron-builder's normal dependency
 * rebuild can continue; returning true keeps node_modules collection intact.
 */
const fs = require("fs");
const path = require("path");

module.exports = async function beforeBuild(context) {
  const cpuFeaturesDir = path.join(
    context.appDir,
    "node_modules",
    "cpu-features"
  );

  await fs.promises.rm(cpuFeaturesDir, { recursive: true, force: true });
  console.log("[before-build] skipped optional cpu-features native build");

  return true;
};
