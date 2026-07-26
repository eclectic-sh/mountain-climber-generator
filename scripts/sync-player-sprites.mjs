import { writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const SOURCE_URL = "https://alttpr.com/sprites";
const ASSET_ORIGIN = "https://alttpr-assets.s3.us-east-2.amazonaws.com";
const VANILLA_SPRITE = "001.link.1.zspr";
const OUTPUT_PATH = resolve("src/data/player-sprites.json");
const ALLOWED_USAGE = new Set(["commercial", "smz3"]);

const response = await fetch(SOURCE_URL);
if (!response.ok) {
  throw new Error(`Sprite catalog request failed with ${response.status}`);
}

const source = await response.json();
if (!Array.isArray(source)) {
  throw new Error("Sprite catalog response is not an array");
}

const filenames = new Set();
const sprites = source
  .map((entry, i) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof entry.name !== "string" ||
      entry.name.length === 0 ||
      typeof entry.author !== "string" ||
      entry.author.length === 0 ||
      typeof entry.file !== "string" ||
      !Array.isArray(entry.usage) ||
      entry.usage.some(
        (usage) => typeof usage !== "string" || !ALLOWED_USAGE.has(usage),
      )
    ) {
      throw new Error(`Invalid sprite catalog entry at index ${i}`);
    }

    const url = new URL(entry.file);
    const file = basename(url.pathname);
    if (
      url.origin !== ASSET_ORIGIN ||
      !/^[a-zA-Z0-9_.-]+\.zspr$/.test(file) ||
      filenames.has(file)
    ) {
      throw new Error(`Invalid or duplicate sprite URL: ${entry.file}`);
    }
    filenames.add(file);

    return {
      name: entry.name,
      author: entry.author,
      file,
      url: url.href,
      usage: [...entry.usage].sort(),
    };
  })
  .filter((sprite) => sprite.file !== VANILLA_SPRITE);

const catalog = {
  source: SOURCE_URL,
  assetHost: ASSET_ORIGIN,
  sprites,
};

await writeFile(OUTPUT_PATH, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Wrote ${sprites.length} official ALttPR sprites to ${OUTPUT_PATH}`);
