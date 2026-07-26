import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { applyBps } from "../../src/rom/bps";
import { sha256 } from "../../src/rom/digest";
import {
  EXPECTED_ROM_DIGESTS,
  HEADERED_ROM_SIZE,
  normalizeRom,
  ROM_SIZE,
  RomValidationError,
} from "../../src/rom/normalize";

test("ROM validation rejects unsupported sizes", async () => {
  await assert.rejects(
    normalizeRom(new Uint8Array(ROM_SIZE - 1)),
    (error) =>
      error instanceof RomValidationError && error.code === "INVALID_SIZE",
  );
});

test("ROM validation rejects a same-size incorrect ROM", async () => {
  await assert.rejects(
    normalizeRom(new Uint8Array(ROM_SIZE)),
    (error) =>
      error instanceof RomValidationError && error.code === "INVALID_ROM",
  );
});

const configuredRom = process.env.MOUNTAIN_CLIMBER_TEST_ROM;
test(
  "known-good local ROM validates with and without a copier header",
  { skip: configuredRom === undefined },
  async () => {
    const source = new Uint8Array(await readFile(configuredRom!));
    const unheadered = await normalizeRom(source);
    assert.equal(unheadered.headerRemoved, false);
    assert.deepEqual(unheadered.digests, EXPECTED_ROM_DIGESTS);

    const headeredBytes = new Uint8Array(HEADERED_ROM_SIZE);
    headeredBytes.fill(0x5a, 0, 512);
    headeredBytes.set(source, 512);
    const headered = await normalizeRom(headeredBytes);
    assert.equal(headered.headerRemoved, true);
    assert.deepEqual(headered.bytes, unheadered.bytes);
    assert.deepEqual(headered.digests, EXPECTED_ROM_DIGESTS);

    const basePatch = new Uint8Array(
      await readFile(resolve("public/patches/base2current.bps")),
    );
    const randomizerBase = applyBps(unheadered.bytes, basePatch, true);
    assert.equal(randomizerBase.length, 2_097_152);
    assert.equal(
      await sha256(randomizerBase),
      "c107fa3be160c8dd333087b394d768dd103c7ca14619ba138859810ded37e349",
    );
  },
);
