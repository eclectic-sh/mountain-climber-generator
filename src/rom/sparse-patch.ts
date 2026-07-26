import type { PatchRecord } from "../generator/protocol";

// Records arrive sorted, non-overlapping, and range-checked from
// mountain_climber.generator._normalize_patch. The bounds check stays because
// this is a raw write into the output ROM.
export function applySparsePatch(
  source: Uint8Array,
  records: readonly PatchRecord[],
): Uint8Array {
  const output = source.slice();
  for (const record of records) {
    if (
      record.offset < 0 ||
      record.offset + record.bytes.length > output.length
    ) {
      throw new Error(
        `Patch record at ${record.offset} writes outside the output ROM`,
      );
    }
    output.set(record.bytes, record.offset);
  }
  return output;
}
