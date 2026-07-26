import assert from "node:assert/strict";
import test from "node:test";

import { applyBps, createBps } from "../../src/rom/bps";
import { crc32Hex } from "../../src/rom/crc32";

test("CRC32 matches the standard check value", () => {
  assert.equal(crc32Hex(new TextEncoder().encode("123456789")), "cbf43926");
});

test("linear BPS creation round trips changed, repeated, and extended data", () => {
  const source = Uint8Array.from({ length: 1024 }, (_, i) => i & 0xff);
  const target = new Uint8Array(1536);
  target.set(source);
  target.fill(0xaa, 20, 80);
  target.fill(0x55, 900, 1100);
  for (let i = 1100; i < target.length; i++) {
    target[i] = (i * 17) & 0xff;
  }
  const patch = createBps(source, target);
  assert.deepEqual(applyBps(source, patch, true), target);
  assert.deepEqual(createBps(source, target), patch);
});

test("BPS validation rejects a wrong source and corrupted patch", () => {
  const source = Uint8Array.from([1, 2, 3, 4, 5]);
  const target = Uint8Array.from([1, 2, 9, 4, 5, 6]);
  const patch = createBps(source, target);
  const wrongSource = source.slice();
  wrongSource[0] = 0;
  assert.throws(() => applyBps(wrongSource, patch, true), /source checksum/);

  const corrupted = patch.slice();
  corrupted[corrupted.length - 5]! ^= 0xff;
  assert.throws(() => applyBps(source, corrupted, true), /patch checksum/);
});
