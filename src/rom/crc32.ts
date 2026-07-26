/*
 * Typed adaptation of LttP Adjuster's js/crc.js.
 * LttP Adjuster: MIT, copyright 2020 Fabio Kubagawa.
 * CRC routine attribution retained from Marc Robledo's Rom Patcher JS.
 */

const TABLE = new Uint32Array(256);
for (let i = 0; i < TABLE.length; i++) {
  let value = i;
  for (let bit = 0; bit < 8; bit++) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  TABLE[i] = value >>> 0;
}

export function crc32(bytes: Uint8Array, end = bytes.length): number {
  if (!Number.isSafeInteger(end) || end < 0 || end > bytes.length) {
    throw new RangeError("CRC32 end is outside the input");
  }
  let crc = 0xffffffff;
  for (let i = 0; i < end; i++) {
    crc = (crc >>> 8) ^ TABLE[(crc ^ bytes[i]!) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function crc32Hex(bytes: Uint8Array): string {
  return crc32(bytes).toString(16).padStart(8, "0");
}
