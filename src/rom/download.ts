import type { GenerateResultV1 } from "../generator/protocol";

export function outputStem(result: GenerateResultV1): string {
  return `${result.mode}-seed-${result.seed}`;
}

export function bpsFilename(result: GenerateResultV1): string {
  return `${outputStem(result)}-from-jp10.bps`;
}

export function downloadBytes(
  bytes: Uint8Array,
  filename: string,
  type = "application/octet-stream",
): void {
  const blob = new Blob([new Uint8Array(bytes).buffer], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
