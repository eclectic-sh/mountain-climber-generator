import { crc32Hex } from "./crc32";
import { sha1, sha256, type RomDigests } from "./digest";

export const ROM_SIZE = 1_048_576;
export const HEADERED_ROM_SIZE = ROM_SIZE + 512;
export const EXPECTED_ROM_DIGESTS: RomDigests = {
  crc32: "3322effc",
  sha1: "e7e852f0159ce612e3911164878a9b08b3cb9060",
  sha256: "794e040b02c7591b59ad8843b51e7c619b88f87cddc6083a8e7a4027b96a2271",
};

export class RomValidationError extends Error {
  constructor(
    readonly code: "INVALID_SIZE" | "INVALID_ROM",
    message: string,
  ) {
    super(message);
    this.name = "RomValidationError";
  }
}

export interface NormalizedRom {
  bytes: Uint8Array;
  headerRemoved: boolean;
  digests: RomDigests;
}

export async function normalizeRom(input: Uint8Array): Promise<NormalizedRom> {
  if (input.length !== ROM_SIZE && input.length !== HEADERED_ROM_SIZE) {
    throw new RomValidationError(
      "INVALID_SIZE",
      "Select an unheadered 1 MiB Japanese v1.0 ROM or its 512-byte-headered equivalent.",
    );
  }

  const headerRemoved = input.length === HEADERED_ROM_SIZE;
  const bytes = headerRemoved
    ? input.slice(512)
    : input.slice();
  const digests = {
    crc32: crc32Hex(bytes),
    sha1: await sha1(bytes),
    sha256: await sha256(bytes),
  };
  if (
    digests.crc32 !== EXPECTED_ROM_DIGESTS.crc32 ||
    digests.sha1 !== EXPECTED_ROM_DIGESTS.sha1 ||
    digests.sha256 !== EXPECTED_ROM_DIGESTS.sha256
  ) {
    throw new RomValidationError(
      "INVALID_ROM",
      "This is not the supported Japanese v1.0 ROM.",
    );
  }
  return { bytes, headerRemoved, digests };
}
