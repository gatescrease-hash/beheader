/**
 * runner.test.ts
 *
 * These tests drive the host's script runner with a backend the test settles
 * by hand, and the worker backend with a fake worker and fake timers, so the
 * cache, the queue and the timeout run with no interpreter at all.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScriptAnswer, ScriptRequest } from "../engine/index.ts";
import { createScriptRunner, createWorkerBackend, type WorkerLike, type WorkerReply, type WorkerRequest } from "./runner.ts";

function manualBackend() {
  const calls: { readonly request: ScriptRequest; readonly settle: (answer: ScriptAnswer) => void }[] = [];
  return {
    calls,
    execute: (request: ScriptRequest) => new Promise<ScriptAnswer>((resolve) => calls.push({ request, settle: resolve })),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createScriptRunner", () => {
  it("answers pending, runs the request once, caches the answer and reports that it settled", async () => {
    const backend = manualBackend();
    const settled = vi.fn();
    const runner = createScriptRunner(backend, settled);
    const request = { source: "return {'a': x}", inputs: { x: 1 } };
    expect(runner.run(request)).toEqual({ status: "pending" });
    expect(runner.run(request)).toEqual({ status: "pending" });
    await flush();
    expect(backend.calls).toHaveLength(1);
    backend.calls[0]!.settle({ status: "done", outputs: { a: 1 } });
    await flush();
    expect(settled).toHaveBeenCalledTimes(1);
    expect(runner.run(request)).toEqual({ status: "done", outputs: { a: 1 } });
    expect(backend.calls).toHaveLength(1);
  });

  it("runs one request at a time, and lets a newer request for the same source replace a queued one", async () => {
    const backend = manualBackend();
    const runner = createScriptRunner(backend, () => {});
    runner.run({ source: "s", inputs: { x: 1 } });
    await flush();
    runner.run({ source: "s", inputs: { x: 2 } });
    runner.run({ source: "s", inputs: { x: 3 } });
    runner.run({ source: "other", inputs: {} });
    await flush();
    expect(backend.calls.map((call) => call.request)).toEqual([{ source: "s", inputs: { x: 1 } }]);
    backend.calls[0]!.settle({ status: "done", outputs: {} });
    await flush();
    backend.calls[1]!.settle({ status: "done", outputs: {} });
    await flush();
    expect(backend.calls.map((call) => call.request)).toEqual([
      { source: "s", inputs: { x: 1 } },
      { source: "s", inputs: { x: 3 } },
      { source: "other", inputs: {} },
    ]);
  });

  it("keeps the most recent answers up to its limit, and turns a backend that throws into a failure", async () => {
    const runner = createScriptRunner({ execute: async (request) => {
      if (request.source === "bad") throw new Error("worker gone");
      return { status: "done", outputs: { source: request.source } };
    } }, () => {}, { cacheLimit: 2 });
    for (const source of ["a", "b", "c", "bad"]) {
      runner.run({ source, inputs: {} });
      await flush();
    }
    expect(runner.run({ source: "bad", inputs: {} })).toEqual({ status: "failed", message: "the script could not run: worker gone" });
    expect(runner.run({ source: "c", inputs: {} })).toMatchObject({ status: "done" });
    expect(runner.run({ source: "a", inputs: {} })).toEqual({ status: "pending" });
  });
});

describe("createWorkerBackend", () => {
  afterEach(() => vi.useRealTimers());

  function fakeWorker() {
    const posted: WorkerRequest[] = [];
    const worker: WorkerLike & { readonly posted: WorkerRequest[]; reply(data: WorkerReply): void; terminated: boolean } = {
      onmessage: null,
      posted,
      terminated: false,
      postMessage: (message) => posted.push(message),
      terminate() { this.terminated = true; },
      reply(data) { this.onmessage?.({ data }); },
    };
    return worker;
  }

  it("resolves with the worker's answer, and starts no timeout until the run begins", async () => {
    vi.useFakeTimers();
    const worker = fakeWorker();
    const backend = createWorkerBackend(() => worker, 1000);
    const answer = backend.execute({ source: "s", inputs: {} });
    vi.advanceTimersByTime(5000);
    worker.reply({ id: 0, started: true });
    worker.reply({ id: 0, answer: { status: "done", outputs: { a: 1 } } });
    await expect(answer).resolves.toEqual({ status: "done", outputs: { a: 1 } });
    expect(worker.terminated).toBe(false);
  });

  it("stops a run past the timeout, ends that worker, and starts a new one for the next request", async () => {
    vi.useFakeTimers();
    const workers = [fakeWorker(), fakeWorker()];
    let made = 0;
    const backend = createWorkerBackend(() => workers[made++]!, 1000);
    const slow = backend.execute({ source: "while True: pass", inputs: {} });
    workers[0]!.reply({ id: 0, started: true });
    vi.advanceTimersByTime(1001);
    await expect(slow).resolves.toEqual({ status: "failed", message: "the script ran for longer than 1 second and was stopped" });
    expect(workers[0]!.terminated).toBe(true);
    void backend.execute({ source: "return {}", inputs: {} });
    expect(made).toBe(2);
    expect(workers[1]!.posted).toEqual([{ id: 1, request: { source: "return {}", inputs: {} } }]);
  });
});
