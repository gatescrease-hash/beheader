/**
 * runner.ts
 *
 * The host's side of running scripts. createScriptRunner gives the engine the
 * ScriptRunner its evaluation context carries: an answer at once from a cache
 * of finished runs, or "pending" for a request it has queued. When a queued run
 * finishes, the runner stores the answer and calls onSettled, and the host
 * evaluates again, which finds the answer in the cache.
 *
 * Answers are cached by the source and the inputs, because a script run in a
 * fresh namespace is a function of those two alone. Two nodes holding the same
 * code and reading the same values share one run for that reason. The cache
 * keeps the most recent answers up to a limit, so a long session of edits does
 * not hold every answer it ever saw.
 *
 * Runs happen one at a time, because one interpreter runs one script at a
 * time. A newer request for the same source replaces an older one still
 * waiting in the queue, so a drag that moves an input through a hundred
 * values queues the latest of them rather than all hundred.
 *
 * createWorkerBackend runs requests in a Web Worker, so a slow script cannot
 * stall drawing or typing. Its timeout starts when the worker reports that a
 * run began, rather than when the request was posted, because the first run
 * waits several seconds for the interpreter to load. A run past the timeout
 * ends the worker outright, since Python gives a running script no safe way
 * to be stopped from outside, and the next request starts a new worker.
 *
 * Host-layer code: it belongs to the browser side of the program and imports
 * from the engine only. The worker arrives through makeWorker, so the tests
 * drive this file in Node with a fake.
 */
import type { ScriptAnswer, ScriptRequest, ScriptRunner } from "../engine/index.ts";

export interface ScriptBackend {
  execute(request: ScriptRequest): Promise<ScriptAnswer>;
}

export interface ScriptRunnerOptions {
  readonly cacheLimit?: number;
}

const DEFAULT_CACHE_LIMIT = 500;

export function scriptRequestKey(request: ScriptRequest): string {
  return JSON.stringify([request.source, request.inputs]);
}

export function createScriptRunner(
  backend: ScriptBackend,
  onSettled: () => void,
  options: ScriptRunnerOptions = {},
): ScriptRunner {
  const cacheLimit = options.cacheLimit ?? DEFAULT_CACHE_LIMIT;
  const answers = new Map<string, ScriptAnswer>();
  const queue = new Map<string, { readonly key: string; readonly request: ScriptRequest }>();
  let running: string | undefined;

  const remember = (key: string, answer: ScriptAnswer): void => {
    answers.delete(key);
    answers.set(key, answer);
    while (answers.size > cacheLimit) {
      answers.delete(answers.keys().next().value!);
    }
  };

  const pump = (): void => {
    if (running !== undefined) return;
    const next = queue.entries().next();
    if (next.done === true) return;
    const [source, { key, request }] = next.value;
    queue.delete(source);
    running = key;
    backend.execute(request).then(
      (answer) => remember(key, answer),
      (error: unknown) => remember(key, { status: "failed", message: `the script could not run: ${error instanceof Error ? error.message : String(error)}` }),
    ).finally(() => {
      running = undefined;
      onSettled();
      pump();
    });
  };

  return {
    run(request) {
      const key = scriptRequestKey(request);
      const known = answers.get(key);
      if (known !== undefined) {
        return known;
      }
      if (running !== key && queue.get(request.source)?.key !== key) {
        queue.delete(request.source);
        queue.set(request.source, { key, request });
        queueMicrotask(pump);
      }
      return { status: "pending" };
    },
  };
}

/** The parts of a Web Worker the backend uses. */
export interface WorkerLike {
  onmessage: ((event: { readonly data: WorkerReply }) => void) | null;
  postMessage(message: WorkerRequest): void;
  terminate(): void;
}

export interface WorkerRequest {
  readonly id: number;
  readonly request: ScriptRequest;
}

export type WorkerReply =
  | { readonly id: number; readonly started: true }
  | { readonly id: number; readonly answer: ScriptAnswer };

export function createWorkerBackend(makeWorker: () => WorkerLike, timeoutMs: number): ScriptBackend {
  let worker: WorkerLike | undefined;
  let nextId = 0;
  const waiting = new Map<number, { readonly resolve: (answer: ScriptAnswer) => void; timer?: ReturnType<typeof setTimeout> }>();

  const start = (): WorkerLike => {
    const created = makeWorker();
    created.onmessage = ({ data }) => {
      const entry = waiting.get(data.id);
      if (entry === undefined) return;
      if ("started" in data) {
        entry.timer = setTimeout(() => {
          waiting.delete(data.id);
          created.terminate();
          if (worker === created) worker = undefined;
          entry.resolve({ status: "failed", message: `the script ran for longer than ${timeoutMs / 1000} second${timeoutMs === 1000 ? "" : "s"} and was stopped` });
        }, timeoutMs);
        return;
      }
      clearTimeout(entry.timer);
      waiting.delete(data.id);
      entry.resolve(data.answer);
    };
    return created;
  };

  return {
    execute(request) {
      return new Promise((resolve) => {
        worker ??= start();
        const id = nextId++;
        waiting.set(id, { resolve });
        worker.postMessage({ id, request });
      });
    },
  };
}
