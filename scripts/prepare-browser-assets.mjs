import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { devDependencies } = JSON.parse(
  await readFile(resolve(workspace, "package.json"), "utf8"),
);
const version = devDependencies.pyodide;
const source = resolve(workspace, "node_modules", "pyodide");
const destination = resolve(
  workspace,
  "public",
  "runtime",
  `pyodide-${version}`,
);
const files = [
  "pyodide.asm.mjs",
  "pyodide.asm.wasm",
  "pyodide-lock.json",
  "pyodide.mjs",
  "python_stdlib.zip",
];

const packageJson = JSON.parse(
  await readFile(resolve(source, "package.json"), "utf8"),
);
if (packageJson.version !== version) {
  throw new Error(`expected Pyodide ${version}, found ${packageJson.version}`);
}

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const file of files) {
  await cp(resolve(source, file), resolve(destination, file));
}
await writeFile(
  resolve(destination, "VERSION"),
  `${version}\n`,
  "utf8",
);

await mkdir(resolve(workspace, "public"), { recursive: true });
for (const [source, destination] of [
  ["LICENSE", "LICENSE.txt"],
  ["THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md"],
]) {
  await cp(
    resolve(workspace, source),
    resolve(workspace, "public", destination),
  );
}
