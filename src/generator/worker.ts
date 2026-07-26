/// <reference lib="webworker" />

import type { PyodideInterface } from "pyodide";

import type {
  GenerateRequestV1,
  GenerateResultV1,
  ProgressStage,
  WorkerResponse,
  WorldInvariants,
} from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

// Replaced at build time from the pyodide pin in package.json.
declare const __PYODIDE_VERSION__: string;

let pyodidePromise: Promise<PyodideInterface> | undefined;

function runtimeUrl(path: string): URL {
  const base = new URL(import.meta.env.BASE_URL, self.location.origin);
  return new URL(`runtime/pyodide-${__PYODIDE_VERSION__}/${path}`, base);
}

function assetUrl(path: string): URL {
  return new URL(path, new URL(import.meta.env.BASE_URL, self.location.origin));
}

function emit(
  id: number,
  stage: ProgressStage,
  requestStartedAt: number,
): void {
  const elapsedMs = performance.now() - requestStartedAt;
  const message: WorkerResponse = { type: "progress", id, stage, elapsedMs };
  self.postMessage(message);
}

async function initialize(
  id: number,
  requestStartedAt: number,
): Promise<PyodideInterface> {
  if (pyodidePromise !== undefined) {
    return pyodidePromise;
  }
  pyodidePromise = (async () => {
    emit(id, "runtime-download", requestStartedAt);
    const loader = runtimeUrl("pyodide.mjs").href;
    const module = (await import(/* @vite-ignore */ loader)) as {
      loadPyodide(config: { indexURL: string }): Promise<PyodideInterface>;
    };

    emit(id, "python-initialize", requestStartedAt);
    const pyodide = await module.loadPyodide({
      indexURL: runtimeUrl("").href,
    });
    const archiveResponse = await fetch(assetUrl("python-runtime.zip"));
    if (!archiveResponse.ok) {
      throw new Error(`Python archive request failed with ${archiveResponse.status}`);
    }
    pyodide.unpackArchive(await archiveResponse.arrayBuffer(), "zip", {
      extractDir: "/app",
    });
    pyodide.runPython('import sys; sys.path.insert(0, "/app/python")');
    return pyodide;
  })();
  return pyodidePromise;
}

async function generate(id: number, request: GenerateRequestV1): Promise<void> {
  const requestStartedAt = performance.now();
  const pyodide = await initialize(id, requestStartedAt);
  const progress = (stage: string): void =>
    emit(id, stage as ProgressStage, requestStartedAt);
  pyodide.globals.set("_mc_request_json", JSON.stringify(request));
  pyodide.globals.set("_mc_progress", progress);
  try {
    const output = await pyodide.runPythonAsync(`
import json
from mountain_climber.generator import generate_with_artifacts
from mountain_climber.invariants import assert_world_invariants

_mc_request = json.loads(_mc_request_json)
_mc_artifacts = generate_with_artifacts(_mc_request, progress=_mc_progress)
_mc_invariants = assert_world_invariants(_mc_artifacts.world, _mc_request["mode"])
json.dumps(
    {"result": _mc_artifacts.result, "invariants": _mc_invariants},
    ensure_ascii=True,
    separators=(",", ":"),
)
`);
    emit(id, "patch-return", requestStartedAt);
    const parsed = JSON.parse(String(output)) as {
      result: GenerateResultV1;
      invariants: WorldInvariants;
    };
    emit(id, "complete", requestStartedAt);
    self.postMessage({
      type: "result",
      id,
      result: parsed.result,
      invariants: parsed.invariants,
    } satisfies WorkerResponse);
  } finally {
    pyodide.globals.delete("_mc_request_json");
    pyodide.globals.delete("_mc_progress");
  }
}

interface GenerateMessage {
  id: number;
  request: GenerateRequestV1;
}

// The page is the only sender, and mountain_climber.protocol re-checks the
// request before the generator sees it.
self.addEventListener("message", (event: MessageEvent<GenerateMessage>) => {
  const { id, request } = event.data;
  void generate(id, request).catch((err: unknown) => {
    self.postMessage({
      type: "error",
      id,
      code: "GENERATION_FAILED",
      message: err instanceof Error ? err.message : "Unknown generation error",
    } satisfies WorkerResponse);
  });
});
