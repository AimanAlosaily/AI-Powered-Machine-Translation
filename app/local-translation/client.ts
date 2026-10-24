import type { Stage, WorkerReply, WorkerRequest } from "./models";

let activeWorker: Worker | undefined;
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function supportsCompactTranslation() {
  return typeof Worker !== "undefined" && typeof WebAssembly !== "undefined";
}

export async function createCompactTranslator(
  stage: Stage,
  signal: AbortSignal,
  onMessage: (message: string) => void,
) {
  if (signal.aborted) throw new DOMException("Translation cancelled.", "AbortError");
  if (!supportsCompactTranslation()) throw new Error("This browser needs WebAssembly and Web Workers for local translation.");
  if (activeWorker) throw new Error("A translation is already running. Cancel it before starting another.");

  const worker = new Worker(`${BASE_PATH}/offline/translation-worker.js`, { type: "module" });
  activeWorker = worker;
  let nextId = 0;
  let closed = false;
  const pending = new Map<number, { resolve: (reply: WorkerReply) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const cancelled = () => new DOMException("Translation cancelled.", "AbortError");

  function destroy(error: Error = cancelled()) {
    if (closed) return;
    closed = true;
    worker.terminate(); // Releases the entire WASM heap, including on cancellation.
    if (activeWorker === worker) activeWorker = undefined;
    signal.removeEventListener("abort", abort);
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  }
  const abort = () => destroy(cancelled());
  signal.addEventListener("abort", abort, { once: true });

  worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
    const request = pending.get(data.id);
    if (!request) return;
    if (data.type === "progress") {
      onMessage(data.message);
      return;
    }
    pending.delete(data.id);
    clearTimeout(request.timer);
    if (data.type === "error") request.reject(new Error(data.message));
    else request.resolve(data);
  };
  worker.onerror = () => destroy(new Error("The local translation worker stopped. Reload Verta, close other heavy tabs, and try again."));
  worker.onmessageerror = () => destroy(new Error("The local translation worker returned an unreadable response."));

  function request(message: WorkerRequest) {
    if (closed || signal.aborted) return Promise.reject(cancelled());
    return new Promise<WorkerReply>((resolve, reject) => {
      const timer = setTimeout(() => destroy(new Error("Local translation timed out. Check the model download or try a smaller document.")), 10 * 60 * 1000);
      pending.set(message.id, { resolve, reject, timer });
      try { worker.postMessage(message); } catch (error) {
        destroy(error instanceof Error ? error : new Error("Cannot start the local model."));
      }
    });
  }

  try {
    await request({ id: ++nextId, type: "init", stage });
  } catch (error) {
    destroy();
    if (error instanceof Error && /fetch|network/i.test(error.message)) {
      throw new Error("The translation model could not be downloaded. Check your connection and access to huggingface.co, then retry. No document text was uploaded.");
    }
    throw error;
  }
  return {
    async translate(text: string) {
      const reply = await request({ id: ++nextId, type: "translate", text });
      if (reply.type !== "result") throw new Error("The local model returned an unexpected response.");
      return reply.text;
    },
    destroy,
  };
}
