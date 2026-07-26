import "./styles.css";

import playerSpriteCatalog from "./data/player-sprites.json";
import { GeneratorClient } from "./generator/client";
import {
  MAX_SEED,
  SETTINGS_VERSION,
  type GenerateRequestV1,
  type GenerateResultV1,
  type Mode,
  type ProgressStage,
} from "./generator/protocol";
import { bpsFilename, downloadBytes, outputStem } from "./rom/download";
import {
  DEFAULT_ROM_CUSTOMIZATIONS,
  loadRomCustomizations,
  saveRomCustomizations,
  type HeartBeepRate,
  type HeartColor,
  type MenuSpeed,
  type RomCustomizations,
} from "./rom/customizations";
import type { NormalizedRom } from "./rom/normalize";
import {
  clearCustomPlayerSprite,
  loadCustomPlayerSprite,
  restorePersistedRom,
  saveCustomPlayerSprite,
  validateAndPersistRom,
} from "./rom/persistence";
import {
  parsePlayerSprite,
  type PlayerSprite,
} from "./rom/player-sprite";
import { buildPatchedRom } from "./rom/pipeline";

const DISPLAY_VERSION = SETTINGS_VERSION.replace("mountain-climber-", "");
const BRIDGE_SCALE = 3;
const BRIDGE_TILE_WIDTH = 24 * BRIDGE_SCALE;
const BRIDGE_EDGE_WIDTH = (177 + 86) * BRIDGE_SCALE;

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null)
    throw new Error(`Required element is missing: ${selector}`);

  return element;
}

const modeDescriptions: Record<
  Mode,
  {
    summary: string;
    pill: string;
    rulesTitle: string;
    entranceRule: string;
  }
> = {
  "mountain-climber": {
    summary: "Vanilla dungeon locations.",
    pill: "Vanilla dungeon entrances",
    rulesTitle: "Mountain Climber Rules",
    entranceRule: "Entrances, rooms, and internal doors remain vanilla",
  },
  "mountain-climber-ex": {
    summary: "Same rules with dungeon entrances shuffled between dungeons.",
    pill: "EX Shuffled dungeon entrances",
    rulesTitle: "Mountain Climber EX Rules",
    entranceRule: "Entrance shuffle. Rooms / internal doors remain vanilla",
  },
};

const progressLabels: Record<ProgressStage, string> = {
  "runtime-download": "Loading",
  "python-initialize": "Initializing",
  "world-build": "Building world",
  "entrance-shuffle": "Connecting entrances",
  "item-pool": "Creating item pool",
  "item-fill": "Placing items",
  patch: "Building patch",
  "logical-validation": "Validating playthrough",
  spoiler: "Preparing spoiler",
  "patch-return": "Returning patch",
  complete: "Complete",
};

// These variants match the base patch's file-select sprites.
const hashIcons: Record<string, string> = {
  Bow: "bow",
  Boomerang: "boomerang",
  Hookshot: "hookshot",
  Bomb: "bomb",
  Mushroom: "mushroom",
  Powder: "powder",
  Rod: "rod",
  Pendant: "pendant",
  Bombos: "bombos",
  Ether: "ether",
  Quake: "quake",
  Lamp: "lamp",
  Hammer: "hammer",
  Shovel: "shovel",
  Ocarina: "ocarina",
  "Bug Net": "bug-net",
  Book: "book",
  Bottle: "bottle",
  Potion: "potion",
  Cane: "cane",
  Cape: "cape",
  Mirror: "mirror",
  Boots: "boots",
  Gloves: "gloves",
  Flippers: "flippers",
  Pearl: "pearl",
  Shield: "shield",
  Tunic: "tunic",
  Heart: "heart",
  Map: "map",
  Compass: "compass",
  Key: "key",
};

const systemVersion = required<HTMLElement>("#system-version");
systemVersion.textContent = DISPLAY_VERSION;
const bridgeBackdrop = required<HTMLElement>("#bridge-backdrop");
const form = required<HTMLFormElement>("#generator-form");

const romInput = required<HTMLInputElement>("#rom");
const romReady = required<HTMLElement>("#rom-ready");
const seedInput = required<HTMLInputElement>("#seed");
const seedDetail = required<HTMLElement>("#seed-detail");
const advancedOptions = required<HTMLDetailsElement>(".advanced-options");
const includeBpsInput = required<HTMLInputElement>("#include-bps");
const raceModeInput = required<HTMLInputElement>("#race-mode");
const playerSpriteInput = required<HTMLSelectElement>("#player-sprite");
const customSpriteInput = required<HTMLInputElement>("#custom-sprite");
const spriteDetail = required<HTMLElement>("#sprite-detail");
const heartColorInput = required<HTMLSelectElement>("#heart-color");
const heartBeepInput = required<HTMLSelectElement>("#heart-beep");
const menuSpeedInput = required<HTMLSelectElement>("#menu-speed");
const quickswapInput = required<HTMLInputElement>("#quickswap");
const reduceFlashingInput = required<HTMLInputElement>("#reduce-flashing");
const musicInput = required<HTMLInputElement>("#music");
const msuResumeInput = required<HTMLInputElement>("#msu-resume");
const customizationPanel = required<HTMLElement>("#customization-panel");

const modeInput = required<HTMLSelectElement>("#mode");

const generateButton = required<HTMLButtonElement>("#generate");
const resetButton = required<HTMLButtonElement>("#reset-form");
const cancelButton = required<HTMLButtonElement>("#cancel");
const downloadRomButton = required<HTMLButtonElement>("#download-rom");
const downloadBpsButton = required<HTMLButtonElement>("#download-bps");
const downloadSpoilerButton = required<HTMLButtonElement>("#download-spoiler");
const copySeedLinkButton = required<HTMLButtonElement>("#copy-seed-link");

const progress = required<HTMLOListElement>("#progress");

const modeDescription = required<HTMLElement>("#mode-description");
const entranceRule = required<HTMLElement>("#entrance-rule");
const rulesTitle = required<HTMLElement>("#rules-title");
const rulesEntranceDetail = required<HTMLElement>("#rules-entrance-detail");
const status = required<HTMLElement>("#status");
const progressPanel = required<HTMLElement>("#progress-panel");
const successPanel = required<HTMLElement>("#success-panel");
const resultMode = required<HTMLElement>("#result-mode");
const resultSeed = required<HTMLElement>("#result-seed");
const resultHash = required<HTMLElement>("#result-hash");
const resultSettings = required<HTMLElement>("#result-settings");
const resultSha = required<HTMLElement>("#result-sha");
const shareSeedLink = required<HTMLInputElement>("#share-seed-link");
const shareLinkStatus = required<HTMLElement>("#share-link-status");
const linkLockNote = required<HTMLElement>("#link-lock-note");

const DEFAULT_SEED_DETAIL = "Leave blank to generate a random seed.";
const LINKED_SEED_DETAIL = "Using seed from shared link.";

interface SharedLink {
  seed: number;
  mode?: Mode;
  race?: boolean;
}

let sharedLink: SharedLink | undefined;

function updateBridgeLayout(): void {
  const centerTiles = Math.max(
    1,
    Math.ceil((window.innerWidth - BRIDGE_EDGE_WIDTH) / BRIDGE_TILE_WIDTH),
  );
  bridgeBackdrop.style.setProperty(
    "--bridge-tile-count",
    centerTiles.toString(),
  );
}

updateBridgeLayout();
window.addEventListener("resize", updateBridgeLayout, { passive: true });

let parallaxFrame = 0;

function updateParallax(): void {
  document.documentElement.style.setProperty(
    "--page-scroll",
    `${window.scrollY}px`,
  );
  parallaxFrame = 0;
}

function scheduleParallaxUpdate(): void {
  if (parallaxFrame === 0) {
    parallaxFrame = window.requestAnimationFrame(updateParallax);
  }
}

updateParallax();
window.addEventListener("scroll", scheduleParallaxUpdate, { passive: true });

let normalizedRom: NormalizedRom | undefined;
let romCustomizations = loadRomCustomizations();
let customPlayerSprite: PlayerSprite | undefined;
const playerSpriteCache = new Map<string, PlayerSprite>();
let activeClient: GeneratorClient | undefined;
let runNumber = 0;
let generated:
  | {
      result: GenerateResultV1;
      rom: Uint8Array;
      bps?: Uint8Array;
      sha256: string;
      spoiler?: Uint8Array;
    }
  | undefined;

function setStatus(message: string, tone: "neutral" | "working" | "success" | "error"): void {
  status.textContent = message;
  status.dataset.tone = tone;
}

function updateRomControl(): void {
  const ready = normalizedRom !== undefined;
  romInput.hidden = ready;
  romReady.hidden = !ready;
}

function readCustomizationControls(): RomCustomizations {
  return {
    sprite: playerSpriteInput.value,
    quickswap: quickswapInput.checked,
    music: musicInput.checked,
    msuResume: msuResumeInput.checked,
    reduceFlashing: reduceFlashingInput.checked,
    menuSpeed: menuSpeedInput.value as MenuSpeed,
    heartBeep: heartBeepInput.value as HeartBeepRate,
    heartColor: heartColorInput.value as HeartColor,
  };
}

function renderCustomizationControls(options: RomCustomizations): void {
  playerSpriteInput.value = playerSpriteCatalog.sprites.some(
    (sprite) => sprite.file === options.sprite,
  )
    ? options.sprite
    : "vanilla";
  quickswapInput.checked = options.quickswap;
  musicInput.checked = options.music;
  msuResumeInput.checked = options.msuResume;
  reduceFlashingInput.checked = options.reduceFlashing;
  menuSpeedInput.value = options.menuSpeed;
  heartBeepInput.value = options.heartBeep;
  heartColorInput.value = options.heartColor;
  updateSpriteControl();
}

function updateSpriteControl(): void {
  const selection = playerSpriteInput.value;
  customSpriteInput.hidden = selection !== "custom";
  if (selection === "custom") {
    spriteDetail.textContent =
      customPlayerSprite === undefined
        ? "Choose a .zspr or .spr file."
        : "Custom sprite loaded.";
    return;
  }

  const catalogSprite = playerSpriteCatalog.sprites.find(
    (sprite) => sprite.file === selection,
  );
  spriteDetail.textContent =
    catalogSprite === undefined
      ? "Use the standard Link sprite."
      : `${catalogSprite.name} by ${catalogSprite.author}`;
}

async function resolvePlayerSprite(): Promise<PlayerSprite | undefined> {
  const selection = romCustomizations.sprite;
  if (selection === "vanilla") {
    return undefined;
  }
  if (selection === "custom") {
    if (customPlayerSprite === undefined) {
      throw new Error("Choose a custom player sprite first.");
    }
    return customPlayerSprite;
  }

  const catalogSprite = playerSpriteCatalog.sprites.find(
    (sprite) => sprite.file === selection,
  );
  if (catalogSprite === undefined) {
    throw new Error("The selected player sprite is no longer available.");
  }
  const cached = playerSpriteCache.get(selection);
  if (cached !== undefined) {
    return cached;
  }

  setStatus(`Loading the ${catalogSprite.name} player sprite.`, "working");
  const response = await fetch(catalogSprite.url);
  if (!response.ok) {
    throw new Error(`The ${catalogSprite.name} player sprite could not be loaded.`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 0x100000) {
    throw new Error("The selected player sprite file is unexpectedly large.");
  }
  const sprite = parsePlayerSprite(bytes);
  playerSpriteCache.set(selection, sprite);
  return sprite;
}

function clearOutput(): void {
  generated = undefined;
  progress.replaceChildren();
  progressPanel.hidden = true;
  successPanel.hidden = true;
}

function selectedMode(): Mode {
  return modeInput.value as Mode;
}

function updateModeCopy(): void {
  const description = modeDescriptions[selectedMode()];
  modeDescription.textContent = description.summary;
  entranceRule.textContent = description.pill;
  entranceRule.dataset.mode = selectedMode();
  rulesTitle.textContent = description.rulesTitle;
  rulesEntranceDetail.textContent = description.entranceRule;
}

function randomSeed(): number {
  const range = 1_000_000_000;
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  const value = new Uint32Array(1);
  do {
    crypto.getRandomValues(value);
  } while (value[0]! >= limit);
  return value[0]! % range;
}

// Links made before the mode and race parameters existed carry a seed alone.
// Those still set the seed, but there is nothing to lock.
function sharedLinkFromQuery(): SharedLink | undefined {
  const params = new URLSearchParams(window.location.search);
  const rawSeed = params.get("s");
  if (rawSeed === null || !/^\d+$/.test(rawSeed)) {
    return undefined;
  }
  const seed = Number(rawSeed);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > MAX_SEED) {
    return undefined;
  }

  const rawMode = params.get("m");
  const rawRace = params.get("r");
  return {
    seed,
    mode: rawMode === null ? undefined : modeFromLinkCode(rawMode),
    race: rawRace === "1" ? true : rawRace === "0" ? false : undefined,
  };
}

const modeLinkCodes: Record<Mode, string> = {
  "mountain-climber": "mc",
  "mountain-climber-ex": "mcex",
};

function modeFromLinkCode(value: string): Mode | undefined {
  return (Object.keys(modeLinkCodes) as Mode[]).find(
    (mode) => modeLinkCodes[mode] === value,
  );
}

function linkLocksSettings(): boolean {
  return sharedLink?.mode !== undefined && sharedLink.race !== undefined;
}

function shareUrl(result: GenerateResultV1): string {
  const url = new URL(window.location.href);
  url.searchParams.set("s", String(result.seed));
  url.searchParams.set("m", modeLinkCodes[result.mode]);
  url.searchParams.set("r", result.race ? "1" : "0");
  url.hash = "";
  return url.toString();
}

function applySharedLink(): void {
  sharedLink = sharedLinkFromQuery();
  if (sharedLink === undefined) {
    return;
  }
  seedInput.value = String(sharedLink.seed);
  seedDetail.textContent = LINKED_SEED_DETAIL;
  if (sharedLink.mode !== undefined) {
    modeInput.value = sharedLink.mode;
  }
  if (sharedLink.race !== undefined) {
    raceModeInput.checked = sharedLink.race;
  }
  updateLinkLock();
  advancedOptions.open = true;
}

function updateLinkLock(): void {
  const locked = linkLocksSettings();
  modeInput.disabled = locked;
  seedInput.disabled = locked;
  raceModeInput.disabled = locked;
  linkLockNote.hidden = !locked;

  for (const control of [modeInput, seedInput, raceModeInput]) {
    control.toggleAttribute("data-link-locked", locked);
  }
}

function clearSharedLink(): void {
  sharedLink = undefined;
  updateLinkLock();
  const url = new URL(window.location.href);
  for (const key of ["s", "m", "r"]) {
    url.searchParams.delete(key);
  }
  window.history.replaceState(null, "", url);
}

function resolveSeed(): number | undefined {
  if (seedInput.value.trim() === "") {
    return randomSeed();
  }
  const seed = Number(seedInput.value);
  return Number.isSafeInteger(seed) && seed >= 0 && seed <= MAX_SEED
    ? seed
    : undefined;
}

function setBusy(busy: boolean): void {
  const locked = linkLocksSettings();
  romInput.disabled = busy;
  modeInput.disabled = busy || locked;
  seedInput.disabled = busy || locked;
  includeBpsInput.disabled = busy;
  raceModeInput.disabled = busy || locked;
  resetButton.disabled = busy;
  for (const input of customizationPanel.querySelectorAll<
    HTMLInputElement | HTMLSelectElement
  >("input, select")) {
    input.disabled = busy;
  }
  generateButton.disabled = busy || normalizedRom === undefined;
  cancelButton.hidden = !busy;
}

function addProgress(stage: ProgressStage, elapsedMs: number): void {
  progressPanel.hidden = false;
  for (const item of progress.querySelectorAll("li")) {
    item.removeAttribute("aria-current");
  }
  const item = document.createElement("li");
  item.setAttribute("aria-current", "step");
  item.innerHTML = `<span>${progressLabels[stage]}</span><time>${(elapsedMs / 1000).toFixed(2)} s</time>`;
  progress.append(item);
}

function modeLabel(mode: Mode): string {
  return mode === "mountain-climber" ? "Mountain Climber" : "Mountain Climber EX";
}

function renderSuccess(): void {
  if (generated === undefined) return;

  const result = generated.result;
  resultMode.textContent = modeLabel(result.mode);
  resultSeed.textContent = String(result.seed);
  resultSettings.textContent = result.settingsVersion;
  resultSha.textContent = generated.sha256;
  shareSeedLink.value = shareUrl(result);
  copySeedLinkButton.textContent = "Copy link";
  shareLinkStatus.textContent =
    "This link locks the seed, mode, and race setting for every racer.";
  resultHash.replaceChildren(
    ...result.hash.map((name) => {
      const item = document.createElement("span");
      item.title = name;
      const icon = hashIcons[name];
      if (icon === undefined) {
        item.textContent = name;
        return item;
      }

      const image = document.createElement("img");
      image.src = `${import.meta.env.BASE_URL}items/hash/${icon}.png`;
      image.alt = name;
      item.append(image);
      return item;
    }),
  );
  downloadBpsButton.hidden = generated.bps === undefined;
  downloadSpoilerButton.hidden = generated.spoiler === undefined;
  successPanel.hidden = false;
  successPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

romInput.addEventListener("change", async () => {
  normalizedRom = undefined;
  clearOutput();
  generateButton.disabled = true;
  const file = romInput.files?.[0];
  if (file === undefined) {
    setStatus("Select your ROM to begin.", "neutral");
    return;
  }

  setStatus("Validating the ROM.", "working");
  try {
    const validation = await validateAndPersistRom(
      new Uint8Array(await file.arrayBuffer()),
    );
    normalizedRom = validation.rom;
    setStatus(
      validation.persisted
        ? "Ready."
        : "Ready. The ROM could not be saved for future sessions.",
      "success",
    );
    updateRomControl();
    generateButton.disabled = false;
  } catch (err) {
    setStatus(
      err instanceof Error ? err.message : "ROM validation failed.",
      "error",
    );
    romInput.value = "";
  }
});

async function restoreSavedRom(): Promise<void> {
  romInput.disabled = true;
  setStatus("Checking for a saved ROM.", "working");
  try {
    if (romCustomizations.sprite === "custom") {
      const storedSprite = await loadCustomPlayerSprite();
      if (storedSprite === undefined) {
        romCustomizations.sprite = "vanilla";
        saveRomCustomizations(romCustomizations);
      } else {
        try {
          customPlayerSprite = parsePlayerSprite(storedSprite);
        } catch {
          await clearCustomPlayerSprite();
          romCustomizations.sprite = "vanilla";
          saveRomCustomizations(romCustomizations);
        }
      }
      renderCustomizationControls(romCustomizations);
    }

    const restoredRom = await restorePersistedRom();
    if (restoredRom === undefined) {
      setStatus("Select your ROM to begin.", "neutral");
      return;
    }

    normalizedRom = restoredRom;
    updateRomControl();
    generateButton.disabled = false;
    setStatus("", "success");
  } catch {
    setStatus("Select your ROM to begin.", "neutral");
  } finally {
    romInput.disabled = false;
  }
}

modeInput.addEventListener("change", updateModeCopy);

customizationPanel.addEventListener("change", () => {
  romCustomizations = readCustomizationControls();
  saveRomCustomizations(romCustomizations);
  updateSpriteControl();
});

customSpriteInput.addEventListener("change", async () => {
  customPlayerSprite = undefined;
  const file = customSpriteInput.files?.[0];
  if (file === undefined) {
    updateSpriteControl();
    return;
  }
  if (file.size > 0x100000) {
    customSpriteInput.value = "";
    updateSpriteControl();
    setStatus("Player sprite files must be no larger than 1 MiB.", "error");
    return;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    customPlayerSprite = parsePlayerSprite(bytes);
    let persisted = true;
    try {
      await saveCustomPlayerSprite(bytes);
    } catch {
      persisted = false;
    }
    updateSpriteControl();
    setStatus(
      persisted
        ? "Custom sprite saved. Ready to generate."
        : "Custom sprite loaded for this session. Ready to generate.",
      "success",
    );
  } catch (err) {
    customSpriteInput.value = "";
    updateSpriteControl();
    setStatus(
      err instanceof Error ? err.message : "Player sprite validation failed.",
      "error",
    );
  }
});

resetButton.addEventListener("click", () => {
  runNumber += 1;
  activeClient?.terminate();
  activeClient = undefined;
  customPlayerSprite = undefined;
  form.reset();
  clearSharedLink();
  seedDetail.textContent = DEFAULT_SEED_DETAIL;
  clearOutput();
  modeInput.value = "mountain-climber";
  updateModeCopy();
  romCustomizations = { ...DEFAULT_ROM_CUSTOMIZATIONS };
  renderCustomizationControls(romCustomizations);
  saveRomCustomizations(romCustomizations);
  updateRomControl();
  setBusy(false);
  setStatus(
    normalizedRom === undefined
      ? "Select your ROM to begin."
      : "Ready to generate.",
    normalizedRom === undefined ? "neutral" : "success",
  );
});

seedInput.addEventListener("input", () => {
  seedDetail.textContent =
    sharedLink !== undefined && seedInput.value === String(sharedLink.seed)
      ? LINKED_SEED_DETAIL
      : DEFAULT_SEED_DETAIL;
});

cancelButton.addEventListener("click", () => {
  runNumber += 1;
  activeClient?.terminate();
  activeClient = undefined;
  progress.querySelector("li[aria-current]")?.removeAttribute("aria-current");
  setBusy(false);
  setStatus("Generation cancelled.", "neutral");
});

downloadRomButton.addEventListener("click", () => {
  if (generated !== undefined) {
    downloadBytes(generated.rom, `${outputStem(generated.result)}.sfc`);
  }
});
downloadBpsButton.addEventListener("click", () => {
  if (generated?.bps !== undefined) {
    downloadBytes(generated.bps, bpsFilename(generated.result));
  }
});
downloadSpoilerButton.addEventListener("click", () => {
  if (generated?.spoiler !== undefined) {
    downloadBytes(
      generated.spoiler,
      `${outputStem(generated.result)}-spoiler.json`,
      "application/json",
    );
  }
});

copySeedLinkButton.addEventListener("click", () => {
  void (async () => {
    try {
      await navigator.clipboard.writeText(shareSeedLink.value);
      copySeedLinkButton.textContent = "Copied";
      shareLinkStatus.textContent = "Copied to your clipboard.";
      window.setTimeout(() => {
        copySeedLinkButton.textContent = "Copy link";
      }, 2000);
    } catch {
      shareSeedLink.focus();
      shareSeedLink.select();
      shareLinkStatus.textContent = "Select the link and copy it manually.";
    }
  })();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void generate();
});

async function generate(): Promise<void> {
  if (normalizedRom === undefined) {
    setStatus("Verify your Japanese v1.0 ROM first.", "error");
    return;
  }
  const seed = resolveSeed();
  if (seed === undefined) {
    setStatus(`Seed must be a whole number from 0 through ${MAX_SEED}.`, "error");
    seedInput.focus();
    return;
  }

  const request: GenerateRequestV1 = {
    schemaVersion: 1,
    mode: selectedMode(),
    seed,
    race: raceModeInput.checked,
    settingsVersion: SETTINGS_VERSION,
  };
  const currentRun = ++runNumber;

  clearOutput();
  setBusy(true);
  setStatus("Loading the generator.", "working");
  const client = new GeneratorClient();
  activeClient = client;
  try {
    const playerSprite = await resolvePlayerSprite();
    const generation = await client.generate(request, (stage, elapsedMs) => {
      if (currentRun !== runNumber) {
        return;
      }
      addProgress(stage, elapsedMs);
      setStatus(progressLabels[stage], "working");
    });
    if (currentRun !== runNumber) {
      return;
    }

    const basePatchResponse = await fetch(
      `${import.meta.env.BASE_URL}patches/base2current.bps`,
    );
    if (!basePatchResponse.ok) {
      throw new Error("The base patch could not be loaded. Reload and try again.");
    }
    const basePatch = new Uint8Array(await basePatchResponse.arrayBuffer());
    setStatus("Building the ROM.", "working");
    const patched = await buildPatchedRom(
      normalizedRom.bytes,
      basePatch,
      generation.result,
      includeBpsInput.checked,
      romCustomizations,
      playerSprite,
    );
    const spoiler =
      generation.result.spoiler === undefined
        ? undefined
        : new TextEncoder().encode(
            `${JSON.stringify(generation.result.spoiler, null, 2)}\n`,
          );
    generated = {
      result: generation.result,
      rom: patched.bytes,
      bps: patched.bps,
      sha256: patched.sha256,
      spoiler,
    };

    downloadBytes(generated.rom, `${outputStem(generated.result)}.sfc`);
    progress.querySelector("li[aria-current]")?.removeAttribute("aria-current");
    setStatus("Generation complete. Your download has started.", "success");
    renderSuccess();
  } catch (err) {
    if (currentRun === runNumber) {
      setStatus(
        err instanceof Error ? err.message : "Generation failed.",
        "error",
      );
    }
  } finally {
    client.terminate();
    if (activeClient === client) {
      activeClient = undefined;
    }
    if (currentRun === runNumber) {
      setBusy(false);
    }
  }
}

for (const sprite of playerSpriteCatalog.sprites) {
  playerSpriteInput.add(
    new Option(
      sprite.author.trim() === ""
        ? sprite.name
        : `${sprite.name} | Author: ${sprite.author}`,
      sprite.file,
    ),
  );
}
renderCustomizationControls(romCustomizations);
seedDetail.textContent = DEFAULT_SEED_DETAIL;
applySharedLink();
updateModeCopy();
void restoreSavedRom();
