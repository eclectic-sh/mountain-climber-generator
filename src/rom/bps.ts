/*
 * Typed BPS adaptation based on LttP Adjuster's js/formats/bps.js.
 * LttP Adjuster: MIT, copyright 2020 Fabio Kubagawa.
 * Original BPS implementation: Marc Robledo, Rom Patcher JS, 2016-2018.
 * Format: https://www.romhacking.net/documents/746/
 */

import { crc32 } from "./crc32";

const MAGIC = [0x42, 0x50, 0x53, 0x31] as const;
const SOURCE_READ = 0;
const TARGET_READ = 1;
const SOURCE_COPY = 2;
const TARGET_COPY = 3;
const MAX_ROM_SIZE = 8 * 1024 * 1024;

class Reader {
  offset = 0;

  constructor(
    readonly bytes: Uint8Array,
    readonly actionEnd = bytes.length,
  ) {}

  byte(limit = this.bytes.length): number {
    if (this.offset >= limit) {
      throw new Error("Unexpected end of BPS patch");
    }
    return this.bytes[this.offset++]!;
  }

  number(limit = this.bytes.length): number {
    let value = 0;
    let shift = 1;
    for (let count = 0; count < 10; count++) {
      const byte = this.byte(limit);
      value += (byte & 0x7f) * shift;
      if (!Number.isSafeInteger(value)) {
        throw new Error("BPS integer is too large to represent exactly");
      }
      if ((byte & 0x80) !== 0) {
        return value;
      }
      shift *= 128;
      value += shift;
      if (!Number.isSafeInteger(shift) || !Number.isSafeInteger(value)) {
        throw new Error("BPS integer overflowed while decoding");
      }
    }
    throw new Error("Malformed BPS variable-length integer");
  }
}

class Writer {
  readonly bytes: number[] = [];

  byte(value: number): void {
    this.bytes.push(value & 0xff);
  }

  number(input: number): void {
    if (!Number.isSafeInteger(input) || input < 0) {
      throw new Error(`Cannot encode ${input} as a BPS integer`);
    }
    let value = input;
    while (true) {
      const byte = value & 0x7f;
      value = Math.floor(value / 128);
      if (value === 0) {
        this.byte(0x80 | byte);
        return;
      }
      this.byte(byte);
      value -= 1;
    }
  }

  uint32(value: number): void {
    this.byte(value);
    this.byte(value >>> 8);
    this.byte(value >>> 16);
    this.byte(value >>> 24);
  }

  data(value: ArrayLike<number>): void {
    for (let i = 0; i < value.length; i++) {
      this.byte(value[i]!);
    }
  }

  output(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

function uint32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

function decodeSigned(value: number): number {
  const magnitude = Math.floor(value / 2);
  return (value & 1) !== 0 ? -magnitude : magnitude;
}

function encodeSigned(value: number): number {
  return Math.abs(value) * 2 + (value < 0 ? 1 : 0);
}

export function applyBps(
  source: Uint8Array,
  patch: Uint8Array,
  validate = true,
): Uint8Array {
  if (patch.length < 19 || MAGIC.some((byte, index) => patch[index] !== byte)) {
    throw new Error("Not a BPS patch: bad magic or truncated header");
  }
  const actionEnd = patch.length - 12;
  const reader = new Reader(patch, actionEnd);
  reader.offset = MAGIC.length;
  const sourceSize = reader.number(actionEnd);
  const targetSize = reader.number(actionEnd);
  if (sourceSize > MAX_ROM_SIZE || targetSize > MAX_ROM_SIZE) {
    throw new Error(
      `BPS declares ${sourceSize} source and ${targetSize} target bytes, past the 8 MiB cap`,
    );
  }
  const metadataSize = reader.number(actionEnd);
  if (reader.offset + metadataSize > actionEnd) {
    throw new Error("BPS metadata exceeds the patch");
  }
  reader.offset += metadataSize;
  if (sourceSize !== source.length) {
    throw new Error(
      `BPS wants a ${sourceSize} byte source, got ${source.length}`,
    );
  }

  const sourceChecksum = uint32(patch, patch.length - 12);
  const targetChecksum = uint32(patch, patch.length - 8);
  const patchChecksum = uint32(patch, patch.length - 4);
  if (validate && crc32(patch, patch.length - 4) !== patchChecksum) {
    throw new Error("Corrupt BPS: the patch checksum failed");
  }
  if (validate && crc32(source) !== sourceChecksum) {
    throw new Error("This patch is for a different ROM (source checksum mismatch)");
  }

  const target = new Uint8Array(targetSize);
  let outputOffset = 0;
  let sourceRelativeOffset = 0;
  let targetRelativeOffset = 0;

  while (reader.offset < actionEnd) {
    const data = reader.number(actionEnd);
    const action = data & 3;
    const length = Math.floor(data / 4) + 1;
    if (outputOffset + length > target.length) {
      throw new Error("BPS action exceeds target size");
    }

    if (action === SOURCE_READ) {
      if (outputOffset + length > source.length) {
        throw new Error("BPS source read runs off the end of the source");
      }
      target.set(source.subarray(outputOffset, outputOffset + length), outputOffset);
      outputOffset += length;
    } else if (action === TARGET_READ) {
      if (reader.offset + length > actionEnd) {
        throw new Error("BPS target read exceeds patch data");
      }
      target.set(patch.subarray(reader.offset, reader.offset + length), outputOffset);
      reader.offset += length;
      outputOffset += length;
    } else {
      const relative = decodeSigned(reader.number(actionEnd));
      if (action === SOURCE_COPY) {
        sourceRelativeOffset += relative;
        if (
          sourceRelativeOffset < 0 ||
          sourceRelativeOffset + length > source.length
        ) {
          throw new Error("BPS source copy points outside the source");
        }
        target.set(
          source.subarray(sourceRelativeOffset, sourceRelativeOffset + length),
          outputOffset,
        );
        sourceRelativeOffset += length;
        outputOffset += length;
      } else if (action === TARGET_COPY) {
        targetRelativeOffset += relative;
        for (let i = 0; i < length; i++) {
          if (
            targetRelativeOffset < 0 ||
            targetRelativeOffset >= outputOffset
          ) {
            throw new Error("BPS target copy references unwritten data");
          }
          target[outputOffset++] = target[targetRelativeOffset++]!;
        }
      }
    }
  }
  if (reader.offset !== actionEnd || outputOffset !== target.length) {
    throw new Error("BPS patch did not produce the declared target size");
  }
  if (validate && crc32(target) !== targetChecksum) {
    throw new Error("Patched output does not match the BPS target checksum");
  }
  return target;
}

export function createBps(source: Uint8Array, target: Uint8Array): Uint8Array {
  const writer = new Writer();
  writer.data(MAGIC);
  writer.number(source.length);
  writer.number(target.length);
  writer.number(0);

  let outputOffset = 0;
  let targetRelativeOffset = 0;
  let targetReadStart = 0;
  let targetReadLength = 0;

  const flushTargetRead = (): void => {
    if (targetReadLength === 0) {
      return;
    }
    writer.number(((targetReadLength - 1) * 4) + TARGET_READ);
    writer.data(
      target.subarray(targetReadStart, targetReadStart + targetReadLength),
    );
    targetReadLength = 0;
  };

  while (outputOffset < target.length) {
    let sourceLength = 0;
    while (
      outputOffset + sourceLength < Math.min(source.length, target.length) &&
      source[outputOffset + sourceLength] === target[outputOffset + sourceLength]
    ) {
      sourceLength++;
    }

    let repeatLength = 0;
    while (
      outputOffset + repeatLength + 1 < target.length &&
      target[outputOffset] === target[outputOffset + repeatLength + 1]
    ) {
      repeatLength++;
    }

    if (repeatLength >= 4) {
      if (targetReadLength === 0) {
        targetReadStart = outputOffset;
      }
      targetReadLength++;
      outputOffset++;
      flushTargetRead();
      writer.number(((repeatLength - 1) * 4) + TARGET_COPY);
      const copyOffset = outputOffset - 1;
      writer.number(encodeSigned(copyOffset - targetRelativeOffset));
      outputOffset += repeatLength;
      targetRelativeOffset = outputOffset - 1;
    } else if (sourceLength >= 4) {
      flushTargetRead();
      writer.number(((sourceLength - 1) * 4) + SOURCE_READ);
      outputOffset += sourceLength;
    } else {
      if (targetReadLength === 0) {
        targetReadStart = outputOffset;
      }
      targetReadLength++;
      outputOffset++;
    }
  }
  flushTargetRead();
  writer.uint32(crc32(source));
  writer.uint32(crc32(target));
  const withoutPatchChecksum = writer.output();
  writer.uint32(crc32(withoutPatchChecksum));
  return writer.output();
}
