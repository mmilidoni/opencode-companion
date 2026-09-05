import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const base = `opencode-companion-${pkg.version}-firefox`;
const staging = join(root, ".zip-stage-firefox");
const zipPath = join(root, `${base}.zip`);

if (!existsSync(join(root, "dist-firefox", "manifest.json"))) {
  console.error("dist-firefox/ is missing — run `npm run build` first.");
  process.exit(1);
}

rmSync(staging, { recursive: true, force: true });
if (existsSync(zipPath)) {
  rmSync(zipPath, { force: true });
}

mkdirSync(staging, { recursive: true });
// dist-firefox/ is self-contained (manifest at its root), so the staging
// folder is an exact copy — the same layout an .xpi expects.
cpSync(join(root, "dist-firefox", "."), staging, { recursive: true });

// Pass explicit names (not ".") so entries have no "./" prefix — Windows
// Explorer's zip viewer shows "./"-prefixed archives as empty.
execFileSync("tar", ["-a", "-cf", zipPath, "-C", staging, "manifest.json", "sw.js", "sidepanel", "popup", "options", "icons"], {
  stdio: "inherit",
});
rmSync(staging, { recursive: true, force: true });
console.log(`Created ${zipPath}`);