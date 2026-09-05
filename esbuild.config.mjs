import { build } from "esbuild";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const srcDir = join(root, "src");
const distDir = join(root, "dist");
const firefoxDir = join(root, "dist-firefox");

/**
 * Entries per target. The service worker is the only one whose module format
 * differs: Chrome loads it as a module service worker, Firefox loads it as a
 * classic event-page script (no module service workers).
 *
 * @type {Array<{ out: string, entry: string, format: "esm" | "iife" }>}
 */
const chromeEntries = [
  { out: "sw", entry: "src/background/sw.ts", format: "esm" },
  // Content script: must be IIFE — content scripts are not ES modules.
  { out: "content/capture", entry: "src/content/capture.ts", format: "iife" },
  { out: "sidepanel/sidepanel", entry: "src/sidepanel/sidepanel.ts", format: "esm" },
  { out: "popup/popup", entry: "src/popup/popup.ts", format: "esm" },
  { out: "options/options", entry: "src/options/options.ts", format: "esm" },
];

const firefoxEntries = [
  { out: "sw", entry: "src/background/sw.ts", format: "iife" },
  { out: "sidepanel/sidepanel", entry: "src/sidepanel/sidepanel.ts", format: "esm" },
  { out: "popup/popup", entry: "src/popup/popup.ts", format: "esm" },
  { out: "options/options", entry: "src/options/options.ts", format: "esm" },
];

function copyStatic(srcRoot, outRoot) {
  for (const name of readdirSync(srcRoot)) {
    const full = join(srcRoot, name);
    if (statSync(full).isDirectory()) {
      copyStatic(full, outRoot);
      continue;
    }
    if (!/\.(html|css)$/.test(name)) continue;
    const target = join(outRoot, relative(srcDir, full));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(full, target);
  }
}

async function buildTarget(outDir, entries, platform) {
  const toBuild = entries.filter((e) => existsSync(join(root, e.entry)));
  await Promise.all(
    toBuild.map((e) =>
      build({
        entryPoints: [join(root, e.entry)],
        outfile: join(outDir, `${e.out}.js`),
        bundle: true,
        format: e.format,
        platform: "browser",
        target: "es2022",
        define: { __PLATFORM__: JSON.stringify(platform) },
        // Drops the dead platform branch (folds `if ("firefox" === "firefox")`)
        // without minifying names, so the Firefox bundle never references
        // chrome.sidePanel and vice versa.
        minifySyntax: true,
        sourcemap: true,
        logLevel: "info",
      }),
    ),
  );
  if (existsSync(srcDir)) copyStatic(srcDir, outDir);
}

function buildFirefoxManifest() {
  // Firefox loads its manifest from dist-firefox/ root, so all paths are
  // relative to that folder (no "dist/" prefix). Derive it from the single
  // source manifest so name/version/permissions never drift.
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  const firefox = {
    ...manifest,
    minimum_chrome_version: undefined,
    background: { scripts: ["sw.js"], persistent: false },
    permissions: manifest.permissions.filter((p) => p !== "sidePanel"),
    side_panel: undefined,
    action: { ...manifest.action, default_popup: "popup/popup.html" },
    options_ui: { ...manifest.options_ui, page: "options/options.html" },
    sidebar_action: { default_panel: "sidepanel/sidepanel.html" },
    browser_specific_settings: {
      gecko: {
        id: "opencode-companion@mmilidoni.github.io",
        // 140 = Firefox ESR line; also the first version with the built-in
        // data-collection consent experience (no custom consent UI needed).
        strict_min_version: "140.0",
        // No data leaves the device: everything goes to the user's own local
        // opencode server. Website content (selection / page text) is the only
        // data the extension transmits, and it is the extension's core
        // function, hence required — nothing is collected optionally.
        data_collection_permissions: { required: ["websiteContent"], optional: [] },
      },
    },
  };
  writeFileSync(join(firefoxDir, "manifest.json"), `${JSON.stringify(firefox, null, 2)}\n`);
}

// Chrome target: dist/ (unchanged layout).
rmSync(distDir, { recursive: true, force: true });
await buildTarget(distDir, chromeEntries, "chrome");

// Firefox target: dist-firefox/ is a self-contained extension (manifest at
// its root), so icons must be copied in and the manifest rewritten for Gecko.
rmSync(firefoxDir, { recursive: true, force: true });
await buildTarget(firefoxDir, firefoxEntries, "firefox");
cpSync(join(root, "icons"), join(firefoxDir, "icons"), { recursive: true });
buildFirefoxManifest();
