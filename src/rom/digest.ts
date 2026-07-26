export interface RomDigests {
  crc32: string;
  sha1: string;
  sha256: string;
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function digest(
  algorithm: "SHA-1" | "SHA-256",
  bytes: Uint8Array,
): Promise<string> {
  const source = new Uint8Array(bytes).buffer;
  return toHex(await crypto.subtle.digest(algorithm, source));
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  return digest("SHA-256", bytes);
}

export async function sha1(bytes: Uint8Array): Promise<string> {
  return digest("SHA-1", bytes);
}
