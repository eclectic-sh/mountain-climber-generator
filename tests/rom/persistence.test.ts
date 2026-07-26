import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ROM_SIZE } from "../../src/rom/normalize";
import {
  restorePersistedRom,
  type RomPersistence,
  validateAndPersistRom,
} from "../../src/rom/persistence";

function persistenceStub(
  overrides: Partial<RomPersistence> = {},
): RomPersistence {
  return {
    load: async () => undefined,
    save: async () => undefined,
    clear: async () => undefined,
    ...overrides,
  };
}

test("an invalid ROM is never passed to browser storage", async () => {
  let saveCalls = 0;
  const persistence = persistenceStub({
    save: async () => {
      saveCalls += 1;
    },
  });

  await assert.rejects(
    validateAndPersistRom(new Uint8Array(ROM_SIZE), persistence),
  );
  assert.equal(saveCalls, 0);
});

test("an invalid saved ROM is discarded from storage", async () => {
  let clearCalls = 0;
  const persistence = persistenceStub({
    load: async () => Uint8Array.of(1, 2, 3, 4),
    clear: async () => {
      clearCalls += 1;
    },
  });

  assert.equal(await restorePersistedRom(persistence), undefined);
  assert.equal(clearCalls, 1);
});

const configuredRom = process.env.MOUNTAIN_CLIMBER_TEST_ROM;
test(
  "a known-good ROM is persisted only after validation",
  { skip: configuredRom === undefined },
  async () => {
    const source = new Uint8Array(await readFile(configuredRom!));
    let saved: Uint8Array | undefined;
    const persistence = persistenceStub({
      save: async (bytes) => {
        saved = bytes.slice();
      },
    });

    const result = await validateAndPersistRom(source, persistence);
    assert.equal(result.persisted, true);
    assert.deepEqual(saved, result.rom.bytes);
  },
);
