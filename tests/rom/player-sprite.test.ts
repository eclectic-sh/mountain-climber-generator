import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPlayerSprite,
  parsePlayerSprite,
} from "../../src/rom/player-sprite";

test("ZSPR graphics, palette, and glove colors parse and patch the ROM", () => {
  const source = new Uint8Array(0x42 + 0x7000 + 0x7c);
  source.set(new TextEncoder().encode("ZSPR"), 0);
  const view = new DataView(source.buffer);
  view.setUint32(9, 0x42, true);
  view.setUint16(13, 0x7000, true);
  view.setUint32(15, 0x7042, true);
  view.setUint16(19, 0x7c, true);
  source.fill(0x31, 0x42, 0x7042);
  source.fill(0x52, 0x7042, 0x70ba);
  source.set([1, 2, 3, 4], 0x70ba);

  const sprite = parsePlayerSprite(source);
  const rom = new Uint8Array(0x200000);
  applyPlayerSprite(rom, sprite);

  assert.equal(rom[0x80000], 0x31);
  assert.equal(rom[0x86fff], 0x31);
  assert.equal(rom[0xdd308], 0x52);
  assert.deepEqual([...rom.slice(0xdedf5, 0xdedf9)], [1, 2, 3, 4]);
});

test("raw SPR files preserve palettes when none are included", () => {
  const source = new Uint8Array(0x7000);
  source.fill(0x7a);
  const sprite = parsePlayerSprite(source);
  const rom = new Uint8Array(0x200000);
  rom.fill(0x22, 0xdd308, 0xdd380);
  applyPlayerSprite(rom, sprite);

  assert.equal(rom[0x80000], 0x7a);
  assert.equal(rom[0xdd308], 0x22);
});

test("legacy 0x7078 sprites derive their glove colors from the palette", () => {
  const source = new Uint8Array(0x7078);
  source.set([1, 2], 0x7036);
  source.set([3, 4], 0x7054);
  const sprite = parsePlayerSprite(source);

  assert.deepEqual(sprite.glovePalette, Uint8Array.of(1, 2, 3, 4));
});

test("malformed ZSPR ranges and sizes are rejected", () => {
  const source = new Uint8Array(32);
  source.set(new TextEncoder().encode("ZSPR"), 0);
  const view = new DataView(source.buffer);
  view.setUint32(9, 24, true);
  view.setUint16(13, 0x7000, true);
  assert.throws(() => parsePlayerSprite(source), /invalid data range/);

  assert.throws(
    () => parsePlayerSprite(new Uint8Array(12)),
    /valid ZSPR/,
  );
});
