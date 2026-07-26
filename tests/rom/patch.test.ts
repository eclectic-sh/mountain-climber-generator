import assert from "node:assert/strict";
import test from "node:test";

import { readSnesChecksum, writeSnesChecksum } from "../../src/rom/checksum";
import { applySparsePatch } from "../../src/rom/sparse-patch";

test("sparse patches apply to a copy and preserve the source", () => {
  const source = new Uint8Array(16);
  const output = applySparsePatch(source, [
    { offset: 2, bytes: [1, 2, 3] },
    { offset: 10, bytes: [9] },
  ]);
  assert.deepEqual([...output.slice(2, 5)], [1, 2, 3]);
  assert.equal(output[10], 9);
  assert.deepEqual(source, new Uint8Array(16));
});

test("sparse patches reject out-of-bounds writes", () => {
  const source = new Uint8Array(8);
  assert.throws(
    () => applySparsePatch(source, [{ offset: 8, bytes: [1] }]),
    /outside/,
  );
  assert.throws(
    () => applySparsePatch(source, [{ offset: 6, bytes: [1, 2, 3] }]),
    /outside/,
  );
});

test("SNES checksum writes complementary header words", () => {
  const rom = Uint8Array.from({ length: 0x10000 }, (_, i) => i & 0xff);
  writeSnesChecksum(rom);
  const checksum = readSnesChecksum(rom);
  assert.equal(checksum.valid, true);
  assert.equal(checksum.checksum ^ checksum.inverse, 0xffff);
});
