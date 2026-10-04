import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const manifest = readJson("manifest.json");
const versions = readJson("versions.json");
const pkg = readJson("package.json");
const lock = readJson("package-lock.json");
const errors = [];
const semver = /^\d+\.\d+\.\d+$/;

if (!manifest.id || manifest.id.includes("obsidian")) errors.push("manifest.id must be a stable, valid Community Plugin ID");
if (!semver.test(manifest.version)) errors.push("manifest.version must be x.y.z");
if (!semver.test(manifest.minAppVersion)) errors.push("manifest.minAppVersion must be x.y.z");
if (pkg.version !== manifest.version || lock.version !== manifest.version || lock.packages?.[""]?.version !== manifest.version) {
  errors.push("package.json, package-lock.json and manifest.json versions differ");
}
if (versions[manifest.version] !== manifest.minAppVersion) errors.push("versions.json does not match the current manifest");
const releaseTag = process.argv[2] || process.env.RELEASE_TAG;
if (releaseTag && releaseTag !== manifest.version) errors.push("release tag must equal manifest.version exactly");

for (const path of ["README.md", "LICENSE", "RELEASE_NOTES.md", "main.js", "manifest.json", "styles.css"]) {
  const absolute = resolve(root, path);
  if (!existsSync(absolute) || statSync(absolute).size === 0) errors.push(`${path} is missing or empty`);
}

if (errors.length) {
  for (const error of errors) console.error(`Release check: ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Release checks passed for ${manifest.id} ${manifest.version}.`);
}
