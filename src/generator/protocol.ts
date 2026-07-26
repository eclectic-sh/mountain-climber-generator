// Both constants are declared again in mountain_climber/protocol.py, which
// re-validates every request. ProtocolParityTests keeps the two files in step.
export const SETTINGS_VERSION = "mountain-climber-v0.81" as const;
export const MAX_SEED = 999_999_999;

export type Mode = "mountain-climber" | "mountain-climber-ex";

export interface GenerateRequestV1 {
  schemaVersion: 1;
  mode: Mode;
  seed: number;
  race: boolean;
  settingsVersion: typeof SETTINGS_VERSION;
}

export interface PatchRecord {
  offset: number;
  bytes: number[];
}

export interface GenerateResultV1 {
  schemaVersion: 1;
  seed: number;
  mode: Mode;
  race: boolean;
  settingsVersion: typeof SETTINGS_VERSION;
  generatorVersion: string;
  pythonVersion: string;
  hash: [string, string, string, string, string];
  patch: PatchRecord[];
  patchDigest: string;
  spoiler?: Record<string, unknown>;
  warnings: string[];
}

export type ProgressStage =
  | "runtime-download"
  | "python-initialize"
  | "world-build"
  | "entrance-shuffle"
  | "item-pool"
  | "item-fill"
  | "logical-validation"
  | "spoiler"
  | "patch"
  | "patch-return"
  | "complete";

export interface WorldInvariants {
  beatable: boolean;
  startingHearts: number;
  maximumHearts: number;
  startingInventory: Record<string, number>;
  blueMailCount: number;
  progressiveSwordCount: number;
  progressiveGloveCount: number;
  pseudoBootsCount: number;
  crystalCount: number;
  filledLocationCount: number;
  itemPoolCount: number;
  entranceShuffle: string;
  doorShuffle: string;
}

export interface WorkerSuccess {
  type: "result";
  id: number;
  result: GenerateResultV1;
  invariants: WorldInvariants;
}

export interface WorkerProgress {
  type: "progress";
  id: number;
  stage: ProgressStage;
  elapsedMs: number;
}

export interface WorkerFailure {
  type: "error";
  id: number;
  code: string;
  message: string;
}

export type WorkerResponse = WorkerSuccess | WorkerProgress | WorkerFailure;
