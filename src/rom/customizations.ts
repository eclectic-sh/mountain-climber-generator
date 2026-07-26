/*
 * Typed adaptation of LttP Adjuster's ZeldaPatcher.js option patches.
 * LttP Adjuster: MIT, copyright 2020 Fabio Kubagawa.
 */

export type HeartColor = "red" | "blue" | "green" | "yellow";
export type HeartBeepRate = "off" | "half" | "quarter" | "normal" | "double";
export type MenuSpeed =
  | "instant"
  | "double"
  | "triple"
  | "quadruple"
  | "half"
  | "normal";

export interface RomCustomizations {
  sprite: string;
  quickswap: boolean;
  music: boolean;
  msuResume: boolean;
  reduceFlashing: boolean;
  menuSpeed: MenuSpeed;
  heartBeep: HeartBeepRate;
  heartColor: HeartColor;
}

export const DEFAULT_ROM_CUSTOMIZATIONS: Readonly<RomCustomizations> = {
  sprite: "vanilla",
  quickswap: true,
  music: true,
  msuResume: true,
  reduceFlashing: true,
  menuSpeed: "normal",
  heartBeep: "normal",
  heartColor: "red",
};

const MINIMUM_ROM_SIZE = 0x18021f;
const SETTINGS_KEY = "mountain-climber-customizations-v1";

const menuSpeedValues: Record<MenuSpeed, number> = {
  instant: 0xe8,
  double: 0x10,
  triple: 0x18,
  quadruple: 0x20,
  half: 0x04,
  normal: 0x08,
};

const heartBeepValues: Record<HeartBeepRate, number> = {
  off: 0x00,
  half: 0x40,
  quarter: 0x80,
  normal: 0x20,
  double: 0x10,
};

const heartColorValues: Record<HeartColor, readonly [number, number]> = {
  red: [0x24, 0x05],
  blue: [0x2c, 0x0d],
  green: [0x3c, 0x19],
  yellow: [0x28, 0x09],
};

const heartColorAddresses = [
  0x6fa1e, 0x6fa20, 0x6fa22, 0x6fa24, 0x6fa26, 0x6fa28, 0x6fa2a,
  0x6fa2c, 0x6fa2e, 0x6fa30,
] as const;

export function applyRomCustomizations(
  rom: Uint8Array,
  options: RomCustomizations,
): void {
  if (rom.length < MINIMUM_ROM_SIZE) {
    throw new Error("ROM is too small for game customization patches");
  }

  rom[0x18004b] = options.quickswap ? 0x01 : 0x00;

  const musicPatches = options.music
    ? [
        [0x0cfe18, [0x70]],
        [0x0cfec1, [0xc0]],
        [0x0d0000, [0xda, 0x58]],
        [0x0d00e7, [0xda, 0x58]],
        [0x18021a, [0x00]],
      ] as const
    : [
        [0x0cfe18, [0x00]],
        [0x0cfec1, [0x00]],
        [0x0d0000, [0x00, 0x00]],
        [0x0d00e7, [0xc4, 0x58]],
        [0x18021a, [0x01]],
      ] as const;
  for (const [offset, bytes] of musicPatches) {
    rom.set(bytes, offset);
  }

  rom.set(options.msuResume ? [0x08, 0x07] : [0x00, 0x00], 0x18021d);
  rom[0x18017f] = options.reduceFlashing ? 0x01 : 0x00;

  const instant = options.menuSpeed === "instant";
  rom[0x6dd9a] = instant ? 0x20 : 0x11;
  rom[0x6df2a] = instant ? 0x20 : 0x12;
  rom[0x6e0e9] = instant ? 0x20 : 0x12;
  rom[0x180048] = menuSpeedValues[options.menuSpeed];

  rom[0x180033] = heartBeepValues[options.heartBeep];
  const [hudColor, fileSelectColor] = heartColorValues[options.heartColor];
  for (const address of heartColorAddresses) {
    rom[address] = hudColor;
  }
  rom[0x65561] = fileSelectColor;
}

const menuSpeedChoices = Object.keys(menuSpeedValues) as MenuSpeed[];
const heartBeepChoices = Object.keys(heartBeepValues) as HeartBeepRate[];
const heartColorChoices = Object.keys(heartColorValues) as HeartColor[];
const spritePattern = /^(?:vanilla|custom|[a-zA-Z0-9_.-]+\.zspr)$/;

const validators: {
  [Key in keyof RomCustomizations]: (
    value: unknown,
  ) => value is RomCustomizations[Key];
} = {
  sprite: (value): value is string =>
    typeof value === "string" && spritePattern.test(value),
  quickswap: isBoolean,
  music: isBoolean,
  msuResume: isBoolean,
  reduceFlashing: isBoolean,
  menuSpeed: (value): value is MenuSpeed => isChoice(value, menuSpeedChoices),
  heartBeep: (value): value is HeartBeepRate =>
    isChoice(value, heartBeepChoices),
  heartColor: (value): value is HeartColor =>
    isChoice(value, heartColorChoices),
};

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isChoice<T extends string>(
  value: unknown,
  choices: readonly T[],
): value is T {
  return typeof value === "string" && choices.includes(value as T);
}

export function loadRomCustomizations(
  storage?: Pick<Storage, "getItem">,
): RomCustomizations {
  let target = storage;
  if (target === undefined) {
    try {
      target = globalThis.localStorage;
    } catch {
      return { ...DEFAULT_ROM_CUSTOMIZATIONS };
    }
  }

  try {
    const raw = target.getItem(SETTINGS_KEY);
    if (raw === null) {
      return { ...DEFAULT_ROM_CUSTOMIZATIONS };
    }
    const value = JSON.parse(raw) as Partial<Record<keyof RomCustomizations, unknown>>;
    const options = { ...DEFAULT_ROM_CUSTOMIZATIONS };
    for (const key of Object.keys(options) as (keyof RomCustomizations)[]) {
      const stored = value[key];
      if (validators[key](stored)) {
        Object.assign(options, { [key]: stored });
      }
    }
    return options;
  } catch {
    return { ...DEFAULT_ROM_CUSTOMIZATIONS };
  }
}

export function saveRomCustomizations(
  options: RomCustomizations,
  storage?: Pick<Storage, "setItem">,
): boolean {
  let target = storage;
  if (target === undefined) {
    try {
      target = globalThis.localStorage;
    } catch {
      return false;
    }
  }
  try {
    target.setItem(SETTINGS_KEY, JSON.stringify(options));
    return true;
  } catch {
    return false;
  }
}
