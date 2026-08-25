/**
 * prompt.ts — AutoCAD-style command prompting: a command word, then one step at a time.
 *
 * IMPLEMENTS: D-072, extending PROJECT_BRIEF §5.10. Not on §6.2's load-bearing list.
 * LAYER: command. A pure state machine: touches no canvas, DOM, or window, and reads
 *        no document. May import: own layer, engine/*. NEVER imported by engine/*.
 *
 * WHAT THIS IS
 *   `circle` alone does not fail here — it starts a sequence. The operator is asked
 *   for a centre point, then for a radius, and answers either by typing (`100,100`,
 *   then `20`) or by picking on the canvas (a click, then a click on the rim). That
 *   is AutoCAD's CIRCLE and it is the reason the command line is worth having for a
 *   drawing tool: placement wants pointing, not four typed numbers (D-072).
 *
 *   Three entry points, all pure functions over a plain `PendingCommand`:
 *     `beginCommand(line)`   — a typed line starts a command, and may finish it.
 *     `respond(pending, r)`  — one answer; yields the next prompt or the `Command`.
 *     `cancelCommand()`      — abandon the sequence.
 *
 *   **A line is a sequence of prompt responses.** `circle`, `circle 100,100` and
 *   `circle 100,100 20` are the same command at three stages of completion — AutoCAD's
 *   space-is-Enter behaviour, which is what makes partial input fall out instead of
 *   being special-cased. §5.10's `key=value` form (`circle x=100 y=100 r=20`) stays as
 *   an alternative COMPLETE form and is routed to `parseCommand` untouched. Both forms
 *   produce the identical `Command`; a test drives every command down both.
 *
 * INVARIANTS UPHELD HERE
 *   - Never throws. Every bad response is a returned re-prompt.
 *   - **A bad answer re-prompts the SAME step and keeps everything already gathered**
 *     (D-072 clause 7). An operator three picks into a command must not lose them to
 *     one typo; only an explicit cancel abandons a sequence.
 *   - `PendingCommand` is plain and serializable — a command name, a step index, and
 *     answers. No closures, no spec object, no live reference: the spec is looked up
 *     from the name on each call, the same stance graph state takes (Rule 5.5).
 *   - A pick arrives as a WORLD point and this file never converts one. Screen-to-world
 *     is `render/camera.ts`'s and `main.ts` does it, which is what keeps this machine
 *     testable with no canvas fake — the property D-068 protects for
 *     `render/interaction.ts` and the reason Rule 1 exists one layer down.
 *   - The prompt sequence lives in `parser.ts`'s registry entry, not here. There is no
 *     second table and no dispatch switch; adding a command stays one entry (§5.10).
 *   - `beginCommand` reads only the line's HEAD WORD before deciding how to route it —
 *     never a whole-line tokenize (D-073, one layer up from `parseCommand`'s own fix):
 *     `set`, the one command with a formula position, declares no `prompts`, so
 *     tokenizing the rest of the line ahead of that check would read a formula's own
 *     quoting before this file ever gets to defer to the file that owns reading it.
 *   - Every extra token past a finished sequence is named directly, at its own offset
 *     (0071-REVIEW F2) — never blamed on the first token the sequence read correctly.
 *     A quoted token is refused the same way a step that cannot read it is (F4):
 *     quoting decides type everywhere else on this line (D-071 clause 3), and no
 *     prompt step accepts a string.
 *
 * NOT DONE HERE
 *   - Object-selection prompts. `select`/`delete`/`refs` prompting "select an object"
 *     needs a pick resolved through `render/hittest.ts` against a document, which is
 *     `main.ts`'s. Those commands keep their typed-name form until then, and arrive as
 *     one `prompts` entry each when they land (D-072, deferred clause).
 *   - Relative coordinates (AutoCAD's `@10,10`). §5.10 shows none and Rule 5 governs;
 *     adding one later is additive.
 *   - Drawing the rubber-band preview between picks (§5.9's visual feedback, D-068).
 *     This file reports which step is live; the renderer draws.
 *   - Executing anything. A finished `Command` goes to `command/commands.ts` (D-069).
 */
import {
  findCommandSpec,
  isCommandParseFailure,
  parseCommand,
  parseCommandNumber,
  readCommandHead,
  tokenizeCommandLine,
  type Command,
  type CommandParseFailure,
  type CommandSpec,
  type CommandToken,
  type PromptAnswers,
  type PromptPoint,
  type PromptStep,
  type PromptValue,
} from "./parser.ts";

/**
 * A command mid-sequence. Plain and serializable by design: the registry entry is
 * found from `commandName` on every call rather than held, so nothing here is a live
 * object reference.
 */
export interface PendingCommand {
  readonly commandName: string;
  readonly stepIndex: number;
  readonly answers: PromptAnswers;
}

/** One answer: typed at the input bar, or picked on the canvas as a world point. */
export type PromptResponse =
  | { readonly kind: "typed"; readonly text: string }
  | { readonly kind: "picked"; readonly point: PromptPoint };

/**
 * Where a command stands after a line or an answer.
 *
 * `prompting` carries the whole `pending` state back rather than mutating anything —
 * the caller holds it and hands it to the next `respond`. `error` is set when the
 * previous answer was refused and the SAME step is being asked again.
 */
export type CommandSession =
  | { readonly status: "complete"; readonly command: Command }
  | {
      readonly status: "prompting";
      readonly pending: PendingCommand;
      readonly message: string;
      readonly error: string | undefined;
    }
  | { readonly status: "failed"; readonly message: string; readonly start: number }
  | { readonly status: "cancelled" };

/**
 * Starts a command from a typed line, and finishes it if the line said enough.
 *
 * Why not just `parseCommand`: §5.10's complete forms are only one of the two ways to
 * say a command now (D-072). This decides which the line is and routes it, so callers
 * have one entry point and `parser.ts` keeps its one-shot contract.
 *
 * Routing, in order: a line whose command word has no prompt sequence, or which uses
 * the `key=value` form, is `parseCommand`'s unchanged. Anything else walks the prompt
 * sequence, with the line's remaining tokens applied as the first answers.
 *
 * Reads only the HEAD word before deciding — never a whole-line tokenize — which is
 * D-073 one layer up from `parseCommand`'s own fix: `set`, the one command with a
 * `literal-or-formula` position, declares no `prompts`, so it always belongs to
 * `parseCommand` below. Tokenizing the rest of the line first (as a single
 * `tokenizeCommandLine(line)` call would) reads a formula's own quoting before this
 * function ever gets to defer to the file that owns reading it.
 */
export function beginCommand(line: string): CommandSession {
  const headScan = readCommandHead(line);
  if (!headScan.ok) {
    return failed(headScan);
  }
  const head = headScan.token;
  if (head === undefined) {
    return failed({ ok: false, message: "empty command", start: 0 });
  }
  const spec = findCommandSpec(head.text);
  const prompts = spec?.prompts;
  // No prompt sequence: this is a complete line and `parseCommand` owns it whole,
  // including any `literal-or-formula` position — reached without this file ever
  // tokenizing past the head word either.
  if (spec === undefined || prompts === undefined) {
    return fromParse(line);
  }
  // A command WITH a prompt sequence never declares a `literal-or-formula` position
  // (D-072's deferred clause — see the header), so tokenizing its remaining tokens has
  // no formula to protect; `headScan.next` keeps every offset absolute (D-073).
  const restTokenized = tokenizeCommandLine(line, headScan.next);
  if (!restTokenized.ok) {
    return failed(restTokenized);
  }
  const rest = restTokenized.tokens;
  // The operator wrote the `key=value` form: also a complete line for `parseCommand`.
  if (usesNamedForm(rest)) {
    return fromParse(line);
  }

  let session: CommandSession = firstPrompt(spec.name, prompts);
  for (const token of rest) {
    if (session.status !== "prompting") {
      // The sequence already finished — this token is SURPLUS, not one the sequence
      // failed to read. Name it directly rather than deferring to `parseCommand`
      // (0071-REVIEW F2): that file's own grammar for a prompting command has no
      // positionals to compare against, so `circle 100,100 20 extra` would blame
      // `100,100` — the token the sequence read CORRECTLY — instead of `extra`.
      return overflow(spec, token);
    }
    if (token.quoted) {
      // Quoting decides type everywhere else on this line (D-071 clause 3), and no
      // prompt step accepts a string — so a quoted answer is a token this step cannot
      // read, not one it should silently reinterpret (0071-REVIEW F4). Same deferral
      // as the "could not read" case below: `parseCommand` explains it in its own
      // grammar, e.g. `circle "100,100" "20"` — "does not take the argument".
      return fromParse(line);
    }
    session = respond(session.pending, { kind: "typed", text: token.text });
    if (session.status === "prompting" && session.error !== undefined) {
      // A token the sequence could not read. Same reasoning: one message, from the
      // file that owns the complete-line form.
      return fromParse(line);
    }
  }
  return session;
}

/**
 * The prompt sequence finished before `token` — it is surplus. Named directly, at its
 * own offset, the same message shape `parseCommand` uses for "does not take the
 * argument" (0071-REVIEW F2): the sequence, unlike `parseCommand`, knows exactly which
 * token is excess, having already read every one before it correctly.
 */
function overflow(spec: CommandSpec, token: CommandToken): CommandSession {
  return { status: "failed", message: `"${spec.name}" does not take the argument "${token.text}" — usage: ${spec.usage}`, start: token.start };
}

/**
 * Answers the live step, and either asks the next one or returns the finished command.
 *
 * Refusing an answer does NOT end the command: the same step is asked again with an
 * `error`, and every answer already gathered survives (D-072 clause 7). That is
 * AutoCAD's behaviour and the only humane one — the alternative throws away three
 * picks because the fourth was mistyped.
 */
export function respond(pending: PendingCommand, response: PromptResponse): CommandSession {
  const spec = findCommandSpec(pending.commandName);
  const prompts = spec?.prompts;
  if (spec === undefined || prompts === undefined) {
    return { status: "failed", message: `"${pending.commandName}" has no prompt sequence`, start: 0 };
  }
  const step = prompts[pending.stepIndex];
  if (step === undefined) {
    return { status: "failed", message: `"${pending.commandName}" has no step ${pending.stepIndex}`, start: 0 };
  }

  const read = readResponse(step, response, pending.answers);
  if (!read.ok) {
    return { status: "prompting", pending, message: promptMessage(step), error: read.reason };
  }

  const answers: PromptAnswers = { ...pending.answers, [step.name]: read.value };
  const nextIndex = pending.stepIndex + 1;
  const nextStep = prompts[nextIndex];
  if (nextStep === undefined) {
    const build = spec.buildFromPrompts;
    if (build === undefined) {
      return { status: "failed", message: `"${spec.name}" declares prompts but cannot build from them`, start: 0 };
    }
    return { status: "complete", command: build(answers) };
  }
  return {
    status: "prompting",
    pending: { commandName: spec.name, stepIndex: nextIndex, answers },
    message: promptMessage(nextStep),
    error: undefined,
  };
}

/** Abandons the sequence. Separate from a refused answer on purpose: only this discards what was gathered (D-072 clause 7). */
export function cancelCommand(): CommandSession {
  return { status: "cancelled" };
}

/** The text an input bar shows for one step, with AutoCAD's `<default>` where there is one (D-072 clause 6). */
export function promptMessage(step: PromptStep): string {
  return step.defaultValue === undefined ? `${step.message}:` : `${step.message} <${step.defaultValue}>:`;
}

/**
 * The result of reading one response: the value, or the reason it was refused.
 *
 * A discriminated shape, not `PromptValue | string` (0071-REVIEW F3). `PromptValue` is
 * `number | PromptPoint` today, so a bare `string` is unambiguously a refusal — but
 * this file already anticipates a `text`-accepting step (`usesNamedForm`'s own hazard
 * note), and `PromptValue` widening to include `string` on that day would make an
 * ACCEPTED text answer indistinguishable from a refusal, turning it into an infinite
 * re-prompt with no compile error to catch it. `{ok:true,value}` / `{ok:false,reason}`
 * makes that widening fail to compile here instead.
 */
type ResponseRead = { readonly ok: true; readonly value: PromptValue } | { readonly ok: false; readonly reason: string };

/** Reads one response as the step's `accepts` kind, or returns the reason it could not — §5.10's "name the specific slots involved" at the layer where the slot does not exist yet. */
function readResponse(step: PromptStep, response: PromptResponse, gathered: PromptAnswers): ResponseRead {
  if (response.kind === "picked") {
    switch (step.accepts) {
      case "point":
        return { ok: true, value: response.point };
      case "distance":
        return asRead(distanceFrom(step, gathered, response.point));
      case "number":
        return { ok: false, reason: `${step.message} takes a typed number, not a point` };
      default: {
        const exhaustive: never = step.accepts;
        void exhaustive;
        return { ok: false, reason: `${step.message} declares a kind this prompt cannot read` };
      }
    }
  }

  const text = response.text.trim();
  if (text.length === 0) {
    // A bare Enter takes the default where there is one — AutoCAD's `<8>`.
    return step.defaultValue === undefined ? { ok: false, reason: `${step.message} needs a value` } : { ok: true, value: step.defaultValue };
  }

  switch (step.accepts) {
    case "point": {
      const point = parsePointLiteral(text);
      return point === undefined ? { ok: false, reason: `${step.message} needs a point as x,y — got "${text}"` } : { ok: true, value: point };
    }
    case "distance": {
      // A typed point is as good as a picked one here: AutoCAD lets you answer the
      // radius prompt with a point on the rim either way.
      const point = parsePointLiteral(text);
      if (point !== undefined) {
        return asRead(distanceFrom(step, gathered, point));
      }
      const distance = parseCommandNumber(text);
      return distance === undefined
        ? { ok: false, reason: `${step.message} needs a number or a point as x,y — got "${text}"` }
        : { ok: true, value: distance };
    }
    case "number": {
      const value = parseCommandNumber(text);
      return value === undefined ? { ok: false, reason: `${step.message} needs a number — got "${text}"` } : { ok: true, value };
    }
    default: {
      const exhaustive: never = step.accepts;
      void exhaustive;
      return { ok: false, reason: `${step.message} declares a kind this prompt cannot read` };
    }
  }
}

/** Lifts `distanceFrom`'s own `number | string` into the discriminated shape above. Kept local to it: `distanceFrom` always yields a `number` on success, so its narrower return type carries none of `readResponse`'s widening hazard. */
function asRead(distance: number | string): ResponseRead {
  return typeof distance === "string" ? { ok: false, reason: distance } : { ok: true, value: distance };
}

/**
 * How far `point` is from the point an earlier step already gave.
 *
 * This is the whole reason a step can name an earlier one: picking a centre and then
 * picking anywhere on the rim is how a radius is given, and neither pick means
 * anything without the other (D-072 clause 5).
 */
function distanceFrom(step: PromptStep, gathered: PromptAnswers, point: PromptPoint): number | string {
  const anchorName = step.relativeTo;
  if (anchorName === undefined) {
    return `${step.message} takes a typed number — it has no point to measure from`;
  }
  const anchor = gathered[anchorName];
  if (anchor === undefined || typeof anchor === "number") {
    return `${step.message} cannot measure from ${anchorName}, which is not a point`;
  }
  return Math.hypot(point.x - anchor.x, point.y - anchor.y);
}

/**
 * §5.10's own point literal, `x,y` — taken from `polyline 0,0 100,0 100,100` and
 * `addvertex polyline_1 100,100` rather than invented here (D-072 clause 4).
 *
 * Both halves use the command line's number form, so `-50,0` works exactly where
 * `x=-50` does.
 */
function parsePointLiteral(text: string): PromptPoint | undefined {
  const separator = text.indexOf(",");
  if (separator < 0) {
    return undefined;
  }
  const x = parseCommandNumber(text.slice(0, separator).trim());
  const y = parseCommandNumber(text.slice(separator + 1).trim());
  return x === undefined || y === undefined ? undefined : { x, y };
}

/** The first step of a fresh sequence. */
function firstPrompt(commandName: string, prompts: readonly PromptStep[]): CommandSession {
  const step = prompts[0];
  if (step === undefined) {
    return { status: "failed", message: `"${commandName}" declares an empty prompt sequence`, start: 0 };
  }
  return {
    status: "prompting",
    pending: { commandName, stepIndex: 0, answers: {} },
    message: promptMessage(step),
    error: undefined,
  };
}

/**
 * Whether the operator wrote §5.10's `key=value` form, which `parseCommand` owns whole.
 *
 * HAZARD — this guard changes no behaviour TODAY and is kept deliberately. Without it
 * `circle x=100 y=100 r=20` still parses, but only by accident: `x=100` fails the
 * point step, and the "a token the sequence could not read" fallback below hands the
 * line to `parseCommand` anyway. That accident holds only while no prompt step accepts
 * arbitrary text — the first `text`-accepting step would swallow `x=100` as an answer
 * and silently break §5.10's documented form. Routing the documented form on purpose
 * costs one predicate; discovering it works by failing through the prompt path costs
 * whoever debugs it later. A mutation check at entry 0070 confirmed no test can tell
 * the two apart, which is the reason this note exists rather than a test.
 */
function usesNamedForm(tokens: readonly { readonly text: string; readonly quoted: boolean }[]): boolean {
  return tokens.some((token) => !token.quoted && token.text.includes("="));
}

/** Runs the complete-line path and lifts its result into a session. */
function fromParse(line: string): CommandSession {
  const result = parseCommand(line);
  return isCommandParseFailure(result) ? failed(result) : { status: "complete", command: result.command };
}

function failed(failure: CommandParseFailure): CommandSession {
  return { status: "failed", message: failure.message, start: failure.start };
}
