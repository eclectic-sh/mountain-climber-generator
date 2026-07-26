import type {
  GenerateRequestV1,
  ProgressStage,
  WorkerResponse,
  WorkerSuccess,
} from "./protocol";

export class GeneratorClient {
  readonly #worker = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  });
  #nextId = 1;

  generate(
    request: GenerateRequestV1,
    onProgress: (stage: ProgressStage, elapsedMs: number) => void,
  ): Promise<WorkerSuccess> {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const listener = (event: MessageEvent<WorkerResponse>): void => {
        const message = event.data;
        if (message.id !== id) {
          return;
        }
        if (message.type === "progress") {
          onProgress(message.stage, message.elapsedMs);
          return;
        }
        this.#worker.removeEventListener("message", listener);
        if (message.type === "error") {
          reject(new Error(`${message.code}: ${message.message}`));
          return;
        }
        resolve(message);
      };
      this.#worker.addEventListener("message", listener);
      this.#worker.postMessage({ id, request });
    });
  }

  terminate(): void {
    this.#worker.terminate();
  }
}
