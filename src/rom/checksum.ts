/*
 * Typed adaptation of LttP Adjuster's ZeldaPatcher.js writeCrc.
 * LttP Adjuster: MIT, copyright 2020 Fabio Kubagawa.
 */

const CHECKSUM_OFFSET = 0x7fdc;

export function writeSnesChecksum(rom: Uint8Array): void {
  if (rom.length < CHECKSUM_OFFSET + 4) {
    throw new Error("ROM is too small for an SNES checksum");
  }
  let sum = 0;
  for (let i = 0; i < rom.length; i++) {
    if (i >= CHECKSUM_OFFSET && i < CHECKSUM_OFFSET + 4) {
      continue;
    }
    sum = (sum + rom[i]!) & 0xffff;
  }
  const checksum = (sum + 0x01fe) & 0xffff;
  const inverse = checksum ^ 0xffff;
  rom.set(
    [
      inverse & 0xff,
      (inverse >>> 8) & 0xff,
      checksum & 0xff,
      (checksum >>> 8) & 0xff,
    ],
    CHECKSUM_OFFSET,
  );
}

export function readSnesChecksum(rom: Uint8Array): {
  checksum: number;
  inverse: number;
  valid: boolean;
} {
  if (rom.length < CHECKSUM_OFFSET + 4) {
    throw new Error(
      `ROM is only ${rom.length} bytes; the checksum words live at 0x7fdc`,
    );
  }
  const inverse = rom[CHECKSUM_OFFSET]! | (rom[CHECKSUM_OFFSET + 1]! << 8);
  const checksum =
    rom[CHECKSUM_OFFSET + 2]! | (rom[CHECKSUM_OFFSET + 3]! << 8);
  return { checksum, inverse, valid: (checksum ^ inverse) === 0xffff };
}
