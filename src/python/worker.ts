/// <reference types="vite/client" />
/**
 * worker.ts
 *
 * The Web Worker that runs scripts. It loads Pyodide once, from the copy the
 * build serves beside the page under pyodide/, and runs each request it is
 * posted through executeScript, reporting first that the run started and then
 * the answer. Serving the interpreter from the program's own files, rather
 * than from a content delivery network, keeps scripts working offline and inside a desktop shell.
 *
 * The interpreter module is imported at run time from that folder rather than
 * bundled, because it loads its WebAssembly and its standard library relative
 * to its own address, and a bundled copy would look for them in the wrong
 * place.
 *
 * Host-layer code: it runs in the worker, with no DOM. runner.ts creates it
 * and is the only file that talks to it.
 */
import type { ScriptAnswer } from "../engine/index.ts";
import { executeScript, type PythonInterpreter } from "./execute.ts";
import type { WorkerReply, WorkerRequest } from "./runner.ts";

interface WorkerScope {
  onmessage: ((event: { readonly data: WorkerRequest }) => void) | null;
  postMessage(message: WorkerReply): void;
  readonly location: { readonly origin: string };
}

const scope = self as unknown as WorkerScope;
const folder = new URL(`${import.meta.env.BASE_URL}pyodide/`, scope.location.origin).href;

const interpreter: Promise<PythonInterpreter> = import(/* @vite-ignore */ `${folder}pyodide.mjs`)
  .then((module: { loadPyodide(options: { indexURL: string }): Promise<unknown> }) => module.loadPyodide({ indexURL: folder }))
  .then((loaded) => loaded as PythonInterpreter);

scope.onmessage = ({ data }) => {
  interpreter.then(
    (python) => {
      scope.postMessage({ id: data.id, started: true });
      scope.postMessage({ id: data.id, answer: executeScript(python, data.request) });
    },
    (error: unknown) => {
      const answer: ScriptAnswer = { status: "failed", message: `Python could not start: ${error instanceof Error ? error.message : String(error)}` };
      scope.postMessage({ id: data.id, answer });
    },
  );
};
