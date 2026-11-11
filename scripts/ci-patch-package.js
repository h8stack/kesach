/**
 * CI-only package.json edits, replacing the jq/sed/PowerShell steps in the
 * release workflow. Usage: node scripts/ci-patch-package.js <mode>
 *
 * Modes:
 *   dev          -> suffix productName with " DEV" for the dev branch
 *   linux-arm64  -> restrict the Linux targets to arm64 deb + AppImage
 *   set-version <tag> -> set package version from a tag (v2.4.9 -> 2.4.9)
 */
const fs = require("fs");
const path = require("path");

const packagePath = path.join(__dirname, "..", "package.json");
const mode = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));

if (mode === "dev") {
  const name = pkg.build.productName.replace(/ DEV$/, "");
  pkg.build.productName = `${name} DEV`;
} else if (mode === "linux-arm64") {
  pkg.build.linux.target = [
    { target: "deb", arch: ["arm64"] },
    { target: "AppImage", arch: ["arm64"] },
  ];
} else if (mode === "set-version") {
  const version = (process.argv[3] || "").replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version)) {
    console.error(`Invalid version: ${process.argv[3] || ""}`);
    process.exit(1);
  }
  pkg.version = version;
} else {
  console.error(`Unknown mode: ${mode}`);
  process.exit(1);
}

fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`package.json patched (${mode})`);
