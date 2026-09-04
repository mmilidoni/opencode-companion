import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const base = `opencode-companion-${pkg.version}`;
const staging = join(root, ".zip-stage");
const zipPath = join(root, `${base}.zip`);

rmSync(staging, { recursive: true, force: true });
if (existsSync(zipPath)) {
  rmSync(zipPath, { force: true });
}

mkdirSync(staging, { recursive: true });
cpSync(join(root, "manifest.json"), join(staging, "manifest.json"));
cpSync(join(root, "dist"), join(staging, "dist"), { recursive: true });
cpSync(join(root, "icons"), join(staging, "icons"), { recursive: true });

// manifest.json must sit at the zip root for the Chrome Web Store.
execFileSync("tar", ["-a", "-cf", zipPath, "-C", staging, "."], { stdio: "inherit" });
rmSync(staging, { recursive: true, force: true });
console.log(`Created ${zipPath}`);