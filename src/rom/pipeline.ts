import type { GenerateResultV1 } from "../generator/protocol";
import { applyBps, createBps } from "./bps";
import { writeSnesChecksum } from "./checksum";
import {
  applyRomCustomizations,
  DEFAULT_ROM_CUSTOMIZATIONS,
  type RomCustomizations,
} from "./customizations";
import { sha256 } from "./digest";
import { applyPlayerSprite, type PlayerSprite } from "./player-sprite";
import { applySparsePatch } from "./sparse-patch";

export interface PatchedRom {
  bytes: Uint8Array;
  sha256: string;
  bps?: Uint8Array;
}

export async function buildPatchedRom(
  baseRom: Uint8Array,
  basePatch: Uint8Array,
  generation: GenerateResultV1,
  includeBps: boolean,
  customizations: RomCustomizations = DEFAULT_ROM_CUSTOMIZATIONS,
  playerSprite?: PlayerSprite,
): Promise<PatchedRom> {
  const randomizerBase = applyBps(baseRom, basePatch, true);
  const bytes = applySparsePatch(randomizerBase, generation.patch);
  applyRomCustomizations(bytes, customizations);
  if (playerSprite !== undefined) {
    applyPlayerSprite(bytes, playerSprite);
  }
  writeSnesChecksum(bytes);

  const output: PatchedRom = { bytes, sha256: await sha256(bytes) };
  if (includeBps) {
    output.bps = createBps(baseRom, bytes);
    const roundTrip = applyBps(baseRom, output.bps, true);
    if ((await sha256(roundTrip)) !== output.sha256) {
      throw new Error("Generated BPS did not recreate the patched ROM");
    }
  }
  return output;
}
