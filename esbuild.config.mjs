import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const srcDir = join(root, "src");
const distDir = join(root, "dist");

/** @type {Array<{ out: string, entry: string, format: "esm" | "iife" }>} */
const entries = [
  // Service worker: ESM (manifest declares "type": "module").
  { out: "sw", entry: "src/background/sw.ts", format: "esm" },
  // Content script: must be IIFE — content scripts are not ES modules.
  { out: "content/capture", entry: "src/content/capture.ts", format: "iife" },
  { out: "sidepanel/sidepanel", entry: "src/sidepanel/sidepanel.ts", format: "esm" },
  { out: "popup/popup", entry: "src/popup/popup.ts", format: "esm" },
  { out: "options/options", entry: "src/options/options.ts", format: "esm" },
];

function copyStatic(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      copyStatic(full);
      continue;
    }
    if (!/\.(html|css)$/.test(name)) continue;
    const target = join(distDir, relative(srcDir, full));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(full, target);
  }
}

const toBuild = entries.filter((e) => existsSync(join(root, e.entry)));

await Promise.all(
  toBuild.map((e) =>
    build({
      entryPoints: [join(root, e.entry)],
      outfile: join(distDir, `${e.out}.js`),
      bundle: true,
      format: e.format,
      platform: "browser",
      target: "chrome116",
      sourcemap: true,
      logLevel: "info",
    }),
  ),
);

if (existsSync(srcDir)) copyStatic(srcDir);