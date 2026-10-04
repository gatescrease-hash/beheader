/**
 * execute.test.ts
 *
 * These tests run scripts in a real Python interpreter, loaded once in Node
 * from the same Pyodide package the browser loads, so they cover what an
 * operator's code meets rather than a fake of it.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadPyodide } from "pyodide";
import { executeScript, pythonErrorMessage, wrapScriptSource, type PythonInterpreter } from "./execute.ts";

let python: PythonInterpreter;

beforeAll(async () => {
  // Pyodide works out its own folder from the URL of its module, which the
  // test runner rewrites, so the folder is named here.
  python = await loadPyodide({ indexURL: new URL("../../node_modules/pyodide/", import.meta.url).pathname }) as unknown as PythonInterpreter;
}, 60_000);

describe("executeScript", () => {
  it("binds each input as a variable and hands back the returned dict, points included", () => {
    const answer = executeScript(python, {
      source: "import math\nreturn {'double': speed * 2, 'root': math.sqrt(speed), 'corner': {'x': speed, 'y': 0}, 'label': f'v={speed}'}",
      inputs: { speed: 9 },
    });
    expect(answer).toEqual({ status: "done", outputs: { double: 18, root: 3, corner: { x: 9, y: 0 }, label: "v=9" } });
  });

  it("passes a point, a list of points, a string and None in as Python values", () => {
    const answer = executeScript(python, {
      source: "return {'n': len(path), 'x': at['x'], 'name': name.upper(), 'none': missing is None}",
      inputs: { path: [{ x: 1, y: 2 }, { x: 3, y: 4 }], at: { x: 5, y: 6 }, name: "road", missing: null },
    });
    expect(answer).toEqual({ status: "done", outputs: { n: 2, x: 5, name: "ROAD", none: true } });
  });

  it("starts every run from a fresh namespace, so nothing an earlier run set is visible", () => {
    executeScript(python, { source: "global leaked\nleaked = 1\nreturn {'ok': 1}", inputs: {} });
    const answer = executeScript(python, { source: "return {'seen': 'leaked' in globals()}", inputs: {} });
    expect(answer).toEqual({ status: "done", outputs: { seen: false } });
  });

  it("reports an exception with the line of the script it happened on", () => {
    const answer = executeScript(python, { source: "a = 1\nreturn {'b': undefined_name}", inputs: {} });
    expect(answer).toEqual({ status: "failed", message: "line 2: NameError: name 'undefined_name' is not defined" });
  });

  it("reports a syntax error, a missing return and a return that is not a dict", () => {
    expect(executeScript(python, { source: "return {'a': }", inputs: {} })).toMatchObject({ status: "failed", message: expect.stringContaining("SyntaxError") });
    expect(executeScript(python, { source: "x = 1", inputs: {} })).toEqual({ status: "failed", message: 'the script returned nothing, so end it with return {"port": value}' });
    expect(executeScript(python, { source: "return 5", inputs: {} })).toEqual({ status: "failed", message: "the script returned a number rather than a dict of outputs" });
    expect(executeScript(python, { source: "return [1, 2]", inputs: {} })).toEqual({ status: "failed", message: "the script returned a list rather than a dict of outputs" });
  });
});

describe("wrapScriptSource and pythonErrorMessage", () => {
  it("makes the source the body of a function, so a top-level return is legal", () => {
    expect(wrapScriptSource("x = 1\nreturn {'x': x}")).toBe(
      "def __beheader_script__():\n    x = 1\n    return {'x': x}\n    return None\n__beheader_result__ = __beheader_script__()\n",
    );
  });

  it("keeps the last line of a traceback, and a line number one less than the wrapped text", () => {
    const traceback = 'Traceback (most recent call last):\n  File "<exec>", line 4, in __beheader_script__\nZeroDivisionError: division by zero\n';
    expect(pythonErrorMessage(new Error(traceback))).toBe("line 3: ZeroDivisionError: division by zero");
    expect(pythonErrorMessage("plain failure")).toBe("plain failure");
  });
});
