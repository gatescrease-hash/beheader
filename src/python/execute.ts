/**
 * execute.ts
 *
 * Runs one script request in a loaded Python interpreter and gives back what
 * it returned, or why it failed. The worker in worker.ts calls this for each
 * request, and the tests call it with an interpreter loaded in Node, which is
 * why it takes the interpreter as an argument rather than loading one.
 *
 * Each run gets a fresh dict as its global namespace, holding one variable for
 * each input port and nothing else. The interpreter stays loaded between runs
 * because loading it takes seconds, and the namespace is new every time
 * because a script that could read the globals an earlier run left behind
 * would give an answer that depends on history rather than on its inputs, and
 * the graph caches answers by source and inputs alone.
 *
 * The source becomes the body of a function, so a script ends with a plain
 * `return {...}` at its top level, which Python refuses outside a function.
 * Each line is indented by the same four spaces, which keeps a script that
 * indents with tabs consistent too. Python numbers the lines of the wrapped
 * text, which carries one line above the script, so pythonErrorMessage takes
 * one off the line number a traceback names.
 *
 * Host-layer code: it belongs to the browser side of the program and imports
 * from the engine only. It runs with no DOM call, so Vitest runs it in Node.
 */
import type { ScriptAnswer, ScriptRequest } from "../engine/index.ts";

/** The parts of a Pyodide interpreter this file uses. */
export interface PythonInterpreter {
  readonly globals: { get(name: string): unknown };
  runPython(code: string, options?: { readonly globals?: unknown }): unknown;
  toPy(value: unknown): unknown;
}

interface PythonDict {
  set(name: string, value: unknown): void;
  get(name: string): unknown;
  destroy(): void;
}

interface PythonValue {
  readonly type: string;
  toJs(options: { readonly dict_converter: (entries: Iterable<[string, unknown]>) => unknown; readonly create_pyproxies: boolean }): unknown;
  destroy(): void;
}

const WRAPPER_NAME = "__beheader_script__";
const RESULT_NAME = "__beheader_result__";

export function wrapScriptSource(source: string): string {
  const body = source.split(/\r?\n/).map((line) => `    ${line}`).join("\n");
  return `def ${WRAPPER_NAME}():\n${body}\n    return None\n${RESULT_NAME} = ${WRAPPER_NAME}()\n`;
}

/**
 * The line of a Python traceback an operator needs: the exception and its
 * message, with the line of their own script it happened on.
 */
export function pythonErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const lines = text.split("\n").map((line) => line.trimEnd()).filter((line) => line.trim() !== "");
  const last = lines[lines.length - 1]?.trim() ?? "the script failed";
  const located = [...text.matchAll(/File "<exec>", line (\d+)/g)].at(-1);
  const line = located === undefined ? undefined : Number(located[1]) - 1;
  return line === undefined || line < 1 ? last : `line ${line}: ${last}`;
}

function isPythonValue(value: unknown): value is PythonValue {
  return typeof value === "object" && value !== null && typeof (value as { toJs?: unknown }).toJs === "function";
}

function describeReturned(value: unknown): string {
  if (isPythonValue(value)) return `a ${value.type}`;
  if (typeof value === "string") return "a string";
  if (typeof value === "boolean") return "a bool";
  return `a ${typeof value === "bigint" ? "int" : typeof value}`;
}

export function executeScript(python: PythonInterpreter, request: ScriptRequest): ScriptAnswer {
  const namespace = (python.globals.get("dict") as () => PythonDict)();
  let returned: unknown;
  try {
    for (const [name, value] of Object.entries(request.inputs)) {
      // Pyodide turns a JavaScript null into a JsNull object of its own and
      // undefined into None, and an empty input means None to a script.
      namespace.set(name, value === null ? undefined : python.toPy(value));
    }
    python.runPython(wrapScriptSource(request.source), { globals: namespace });
    returned = namespace.get(RESULT_NAME);
    if (returned === undefined || returned === null) {
      return { status: "failed", message: "the script returned nothing, so end it with return {\"port\": value}" };
    }
    if (!isPythonValue(returned) || returned.type !== "dict") {
      return { status: "failed", message: `the script returned ${describeReturned(returned)} rather than a dict of outputs` };
    }
    const outputs = returned.toJs({ dict_converter: (entries) => Object.fromEntries(entries), create_pyproxies: false });
    return { status: "done", outputs: outputs as Record<string, unknown> };
  } catch (error) {
    return { status: "failed", message: pythonErrorMessage(error) };
  } finally {
    if (isPythonValue(returned)) returned.destroy();
    namespace.destroy();
  }
}
