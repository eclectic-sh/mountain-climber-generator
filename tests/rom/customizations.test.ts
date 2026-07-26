import assert from "node:assert/strict";
import test from "node:test";

import {
  applyRomCustomizations,
  DEFAULT_ROM_CUSTOMIZATIONS,
  loadRomCustomizations,
  saveRomCustomizations,
  type RomCustomizations,
} from "../../src/rom/customizations";

function blankRom(): Uint8Array {
  return new Uint8Array(0x200000);
}

test("default game options preserve current randomizer option values", () => {
  const rom = blankRom();
  applyRomCustomizations(rom, { ...DEFAULT_ROM_CUSTOMIZATIONS });

  assert.equal(rom[0x18004b], 0x01);
  assert.equal(rom[0x180048], 0x08);
  assert.equal(rom[0x180033], 0x20);
  assert.deepEqual([...rom.slice(0x18021d, 0x18021f)], [0x08, 0x07]);
  assert.equal(rom[0x18017f], 0x01);
  assert.equal(rom[0x65561], 0x05);
  assert.equal(rom[0x6fa1e], 0x24);
});

test("game options apply every non-default patch", () => {
  const rom = blankRom();
  const options: RomCustomizations = {
    sprite: "vanilla",
    quickswap: false,
    music: false,
    msuResume: false,
    reduceFlashing: false,
    menuSpeed: "instant",
    heartBeep: "off",
    heartColor: "blue",
  };
  applyRomCustomizations(rom, options);

  assert.equal(rom[0x18004b], 0x00);
  assert.deepEqual(
    [
      rom[0x0cfe18],
      rom[0x0cfec1],
      ...rom.slice(0x0d0000, 0x0d0002),
      ...rom.slice(0x0d00e7, 0x0d00e9),
      rom[0x18021a],
    ],
    [0x00, 0x00, 0x00, 0x00, 0xc4, 0x58, 0x01],
  );
  assert.deepEqual([...rom.slice(0x18021d, 0x18021f)], [0x00, 0x00]);
  assert.equal(rom[0x18017f], 0x00);
  assert.deepEqual(
    [rom[0x6dd9a], rom[0x6df2a], rom[0x6e0e9], rom[0x180048]],
    [0x20, 0x20, 0x20, 0xe8],
  );
  assert.equal(rom[0x180033], 0x00);
  assert.equal(rom[0x65561], 0x0d);
  assert.equal(rom[0x6fa30], 0x2c);
});

test("saved options are validated and malformed values fall back safely", () => {
  const loaded = loadRomCustomizations({
    getItem: () =>
      JSON.stringify({
        quickswap: true,
        music: "no",
        menuSpeed: "triple",
        heartBeep: "invalid",
        heartColor: "green",
      }),
  });
  assert.equal(loaded.quickswap, true);
  assert.equal(loaded.music, DEFAULT_ROM_CUSTOMIZATIONS.music);
  assert.equal(loaded.menuSpeed, "triple");
  assert.equal(loaded.heartBeep, DEFAULT_ROM_CUSTOMIZATIONS.heartBeep);
  assert.equal(loaded.heartColor, "green");

  let serialized = "";
  assert.equal(
    saveRomCustomizations(loaded, {
      setItem: (_key, value) => {
        serialized = value;
      },
    }),
    true,
  );
  assert.deepEqual(JSON.parse(serialized), loaded);
});
