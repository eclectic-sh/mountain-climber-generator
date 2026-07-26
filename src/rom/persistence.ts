import { normalizeRom, type NormalizedRom } from "./normalize";

const DATABASE_NAME = "mountain-climber-generator";
const DATABASE_VERSION = 2;
const STORE_NAME = "roms";
const SPRITE_STORE_NAME = "sprites";
const BASE_ROM_KEY = "jp-v1.0";
const CUSTOM_SPRITE_KEY = "custom-player";

interface StoredRomRecord {
  id: typeof BASE_ROM_KEY;
  bytes: ArrayBuffer;
}

interface StoredSpriteRecord {
  id: typeof CUSTOM_SPRITE_KEY;
  bytes: ArrayBuffer;
}

export interface RomPersistence {
  load(): Promise<Uint8Array | undefined>;
  save(bytes: Uint8Array): Promise<void>;
  clear(): Promise<void>;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("Browser storage request failed.")),
      { once: true },
    );
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () =>
        reject(
          transaction.error ?? new Error("Browser storage transaction was aborted."),
        ),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () =>
        reject(transaction.error ?? new Error("Browser storage transaction failed.")),
      { once: true },
    );
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is unavailable."));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener(
      "upgradeneeded",
      () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
        if (!request.result.objectStoreNames.contains(SPRITE_STORE_NAME)) {
          request.result.createObjectStore(SPRITE_STORE_NAME, { keyPath: "id" });
        }
      },
      { once: true },
    );
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("Browser storage could not be opened.")),
      { once: true },
    );
    request.addEventListener(
      "blocked",
      () => reject(new Error("Browser storage upgrade was blocked.")),
      { once: true },
    );
  });
}

export const browserRomPersistence: RomPersistence = {
  async load() {
    if (typeof indexedDB === "undefined") {
      return undefined;
    }

    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction
        .objectStore(STORE_NAME)
        .get(BASE_ROM_KEY) as IDBRequest<StoredRomRecord | undefined>;
      const record = await requestResult(request);
      if (record === undefined) {
        return undefined;
      }
      if (!(record.bytes instanceof ArrayBuffer)) {
        return new Uint8Array();
      }
      return new Uint8Array(record.bytes);
    } finally {
      database.close();
    }
  },

  async save(bytes) {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const completion = transactionComplete(transaction);
      transaction.objectStore(STORE_NAME).put({
        id: BASE_ROM_KEY,
        bytes: bytes.slice().buffer,
      } satisfies StoredRomRecord);
      await completion;
    } finally {
      database.close();
    }
  },

  async clear() {
    if (typeof indexedDB === "undefined") {
      return;
    }

    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const completion = transactionComplete(transaction);
      transaction.objectStore(STORE_NAME).delete(BASE_ROM_KEY);
      await completion;
    } finally {
      database.close();
    }
  },
};

export async function loadCustomPlayerSprite(): Promise<
  Uint8Array | undefined
> {
  if (typeof indexedDB === "undefined") {
    return undefined;
  }

  const database = await openDatabase();
  try {
    const transaction = database.transaction(SPRITE_STORE_NAME, "readonly");
    const request = transaction
      .objectStore(SPRITE_STORE_NAME)
      .get(CUSTOM_SPRITE_KEY) as IDBRequest<StoredSpriteRecord | undefined>;
    const record = await requestResult(request);
    return record?.bytes instanceof ArrayBuffer
      ? new Uint8Array(record.bytes)
      : undefined;
  } finally {
    database.close();
  }
}

export async function saveCustomPlayerSprite(bytes: Uint8Array): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SPRITE_STORE_NAME, "readwrite");
    const completion = transactionComplete(transaction);
    transaction.objectStore(SPRITE_STORE_NAME).put({
      id: CUSTOM_SPRITE_KEY,
      bytes: bytes.slice().buffer,
    } satisfies StoredSpriteRecord);
    await completion;
  } finally {
    database.close();
  }
}

export async function clearCustomPlayerSprite(): Promise<void> {
  if (typeof indexedDB === "undefined") {
    return;
  }
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SPRITE_STORE_NAME, "readwrite");
    const completion = transactionComplete(transaction);
    transaction.objectStore(SPRITE_STORE_NAME).delete(CUSTOM_SPRITE_KEY);
    await completion;
  } finally {
    database.close();
  }
}

export async function validateAndPersistRom(
  input: Uint8Array,
  persistence: RomPersistence = browserRomPersistence,
): Promise<{ rom: NormalizedRom; persisted: boolean }> {
  const rom = await normalizeRom(input);
  try {
    await persistence.save(rom.bytes);
    return { rom, persisted: true };
  } catch {
    return { rom, persisted: false };
  }
}

export async function restorePersistedRom(
  persistence: RomPersistence = browserRomPersistence,
): Promise<NormalizedRom | undefined> {
  const bytes = await persistence.load();
  if (bytes === undefined) {
    return undefined;
  }

  try {
    return await normalizeRom(bytes);
  } catch {
    try {
      await persistence.clear();
    } catch {
      // A corrupt entry should not prevent the user from selecting a ROM.
    }
    return undefined;
  }
}
