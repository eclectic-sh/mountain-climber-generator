import assert from "node:assert/strict";
import test from "node:test";

import playerSpriteCatalog from "../../src/data/player-sprites.json";

test("catalog sprites use the official ALttPR asset host", () => {
  assert.equal(playerSpriteCatalog.source, "https://alttpr.com/sprites");
  assert.equal(
    playerSpriteCatalog.assetHost,
    "https://alttpr-assets.s3.us-east-2.amazonaws.com",
  );
  const filenames = new Set<string>();
  for (const sprite of playerSpriteCatalog.sprites) {
    const url = new URL(sprite.url);
    assert.equal(url.origin, playerSpriteCatalog.assetHost);
    assert.equal(url.pathname.slice(1), sprite.file);
    assert.match(sprite.file, /^[a-zA-Z0-9_.-]+\.zspr$/);
    assert.notEqual(sprite.file, "001.link.1.zspr");
    assert.ok(!filenames.has(sprite.file));
    filenames.add(sprite.file);
    assert.ok(sprite.name.length > 0);
    assert.ok(sprite.author.length > 0);
    assert.ok(
      sprite.usage.every((usage) => usage === "commercial" || usage === "smz3"),
    );
  }
});
