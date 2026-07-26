import assert from "node:assert/strict";
import test from "node:test";

import type { GenerateResultV1 } from "../../src/generator/protocol";
import { bpsFilename, outputStem } from "../../src/rom/download";

const result = {
  mode: "mountain-climber-ex",
  seed: 42,
} as GenerateResultV1;

test("output filenames are deterministic and avoid emulator auto-patching", () => {
  assert.equal(outputStem(result), "mountain-climber-ex-seed-42");
  assert.equal(
    bpsFilename(result),
    "mountain-climber-ex-seed-42-from-jp10.bps",
  );
});
