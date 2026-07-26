import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { zipSync } from "fflate";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const roots = [
  resolve(workspace, "python", "mountain_climber"),
  resolve(workspace, "python", "vendor", "alttp-door-randomizer"),
  resolve(workspace, "presets"),
];
const archiveEntries = {};

async function addTree(root) {
  for (const name of await readdir(root)) {
    if (name === "__pycache__" || name.endsWith(".pyc")) {
      continue;
    }
    const path = resolve(root, name);
    const info = await stat(path);
    if (info.isDirectory()) {
      await addTree(path);
      continue;
    }
    const archivePath = relative(workspace, path).split(sep).join("/");
    archiveEntries[archivePath] = new Uint8Array(await readFile(path));
  }
}

for (const root of roots) {
  await addTree(root);
}

const archive = zipSync(archiveEntries, { level: 9 });
await writeFile(resolve(workspace, "public", "python-runtime.zip"), archive);
console.log(
  `packaged ${Object.keys(archiveEntries).length} files in ${archive.length} bytes`,
);
