/*
 * Typed adaptation of LttP Adjuster's ZeldaSprite.js and spritePatch.
 * LttP Adjuster: MIT, copyright 2020 Fabio Kubagawa.
 */

const GRAPHICS_SIZE = 0x7000;
const PALETTE_SIZE = 0x78;
const GLOVE_PALETTE_SIZE = 0x04;

export interface PlayerSprite {
  graphics: Uint8Array;
  palette?: Uint8Array;
  glovePalette?: Uint8Array;
}

function copyRange(
  source: Uint8Array,
  offset: number,
  length: number,
): Uint8Array {
  if (offset < 0 || length < 0 || offset + length > source.length) {
    throw new Error("Sprite file contains an invalid data range.");
  }
  return source.slice(offset, offset + length);
}

export function parsePlayerSprite(source: Uint8Array): PlayerSprite {
  if (
    source.length === GRAPHICS_SIZE ||
    source.length === GRAPHICS_SIZE + PALETTE_SIZE ||
    source.length === GRAPHICS_SIZE + PALETTE_SIZE + GLOVE_PALETTE_SIZE
  ) {
    const embeddedGlovePalette =
      source.length === GRAPHICS_SIZE + PALETTE_SIZE
        ? Uint8Array.of(
            source[0x7036]!,
            source[0x7037]!,
            source[0x7054]!,
            source[0x7055]!,
          )
        : undefined;
    return {
      graphics: copyRange(source, 0, GRAPHICS_SIZE),
      palette:
        source.length >= GRAPHICS_SIZE + PALETTE_SIZE
          ? copyRange(source, GRAPHICS_SIZE, PALETTE_SIZE)
          : undefined,
      glovePalette:
        source.length === GRAPHICS_SIZE + PALETTE_SIZE + GLOVE_PALETTE_SIZE
          ? copyRange(
              source,
              GRAPHICS_SIZE + PALETTE_SIZE,
              GLOVE_PALETTE_SIZE,
            )
          : embeddedGlovePalette,
    };
  }

  if (
    source.length < 21 ||
    new TextDecoder("ascii").decode(source.subarray(0, 4)) !== "ZSPR"
  ) {
    throw new Error("Select a valid ZSPR or 0x7000-byte SPR player sprite.");
  }

  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const graphicsOffset = view.getUint32(9, true);
  const graphicsSize = view.getUint16(13, true);
  const paletteOffset = view.getUint32(15, true);
  const paletteSize = view.getUint16(19, true);

  if (graphicsSize !== GRAPHICS_SIZE) {
    throw new Error(
      `This ZSPR declares ${graphicsSize} bytes of graphics, not 0x7000.`,
    );
  }
  if (
    paletteSize !== 0 &&
    paletteSize !== PALETTE_SIZE &&
    paletteSize !== PALETTE_SIZE + GLOVE_PALETTE_SIZE
  ) {
    throw new Error("Sprite file has an unsupported palette size.");
  }

  return {
    graphics: copyRange(source, graphicsOffset, GRAPHICS_SIZE),
    palette:
      paletteSize === 0
        ? undefined
        : copyRange(source, paletteOffset, PALETTE_SIZE),
    glovePalette:
      paletteSize === PALETTE_SIZE + GLOVE_PALETTE_SIZE
        ? copyRange(
            source,
            paletteOffset + PALETTE_SIZE,
            GLOVE_PALETTE_SIZE,
          )
        : undefined,
  };
}

export function applyPlayerSprite(
  rom: Uint8Array,
  sprite: PlayerSprite,
): void {
  if (rom.length < 0xdedf5 + GLOVE_PALETTE_SIZE) {
    throw new Error("ROM is too small for a player sprite");
  }
  if (sprite.graphics.length !== GRAPHICS_SIZE) {
    throw new Error("Player sprite graphics must be exactly 0x7000 bytes");
  }
  if (sprite.palette !== undefined && sprite.palette.length !== PALETTE_SIZE) {
    throw new Error(
      `Player sprite palette is ${sprite.palette.length} bytes, expected 0x78`,
    );
  }
  if (
    sprite.glovePalette !== undefined &&
    sprite.glovePalette.length !== GLOVE_PALETTE_SIZE
  ) {
    throw new Error("Glove palette must be 4 bytes");
  }

  rom.set(sprite.graphics, 0x80000);
  if (sprite.palette !== undefined) {
    rom.set(sprite.palette, 0xdd308);
  }
  if (sprite.glovePalette !== undefined) {
    rom.set(sprite.glovePalette, 0xdedf5);
  }
}
