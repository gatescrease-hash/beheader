/**
 * prompt.ts
 *
 * Layer: command. It turns a typed line into mutation calls. It imports from
 * engine and from its own layer.
 *
 * The prompt sequence, in the AutoCAD style. A bare command word starts it,
 * and the prompt asks for each argument in turn.
 *
 * This is a state machine of its own. parser.ts answers only the one shot
 * question "is this complete line a command".
 *
 * A step that repeats collects answers until the operator ends it. It holds
 * them as a stroke list, so a point and a word such as "arc" keep their order.
 * The step index does not move while such a step collects.
 */
import {
  findCommandSpec,
  isCommandParseFailure,
  isPromptPoint,
  parseCommand,
  parseCommandNumber,
  readCommandHead,
  tokenizeCommandLine,
  type Command,
  type CommandParseFailure,
  type CommandSpec,
  type CommandToken,
  type PromptAnswers,
  type PromptOption,
  type PromptPoint,
  type PromptStep,
  type PromptStroke,
  type PromptValue,
} from "./parser.ts";

export interface PendingCommand {
  readonly commandName: string;
  readonly stepIndex: number;
  readonly answers: PromptAnswers;
}

export type PromptResponse =
  | { readonly kind: "typed"; readonly text: string }
  | { readonly kind: "picked"; readonly point: PromptPoint };

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

/** Starts a prompt sequence from a bare command word. */
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
  if (spec === undefined || prompts === undefined) {
    return fromParse(line);
  }
  const restTokenized = tokenizeCommandLine(line, headScan.next);
  if (!restTokenized.ok) {
    return failed(restTokenized);
  }
  const rest = restTokenized.tokens;
  if (usesNamedForm(rest)) {
    return fromParse(line);
  }

  let session: CommandSession = firstPrompt(spec.name, prompts);
  for (const token of rest) {
    if (session.status !== "prompting") {
      return overflow(spec, token);
    }
    if (token.quoted) {
      return fromParse(line);
    }
    session = respond(session.pending, { kind: "typed", text: token.text });
    if (session.status === "prompting" && session.error !== undefined) {
      return fromParse(line);
    }
  }
  return session;
}

function overflow(spec: CommandSpec, token: CommandToken): CommandSession {
  return { status: "failed", message: `"${spec.name}" does not take the argument "${token.text}" — usage: ${spec.usage}`, start: token.start };
}

/** Feeds one answer to a prompt sequence and asks the next question. */
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
  if (step.repeats === true) {
    return respondRepeating(spec, prompts, pending, step, response);
  }

  const read = readResponse(step, response, pending.answers);
  if (!read.ok) {
    return { status: "prompting", pending, message: promptMessage(step, pending.answers), error: read.reason };
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
    message: promptMessage(nextStep, answers),
    error: undefined,
  };
}

/**
 * One answer to a step that repeats.
 *
 * An empty answer ends the step, once it holds the points it needs. A word the
 * step offers takes its effect. Anything else must read as a point, and joins
 * the list.
 */
function respondRepeating(
  spec: CommandSpec,
  prompts: readonly PromptStep[],
  pending: PendingCommand,
  step: PromptStep,
  response: PromptResponse,
): CommandSession {
  const strokes = strokesOf(pending.answers, step);
  if (response.kind === "typed") {
    const text = response.text.trim();
    if (text.length === 0) {
      return endsHere(spec, prompts, pending, step, strokes);
    }
    const option = matchOption(step, strokes, text);
    if (option !== undefined) {
      return applyOption(spec, prompts, pending, step, strokes, option);
    }
    const point = parsePointLiteral(text);
    if (point === undefined) {
      return asking(spec, pending, step, strokes, `${step.message} needs a point as x,y or one of the words offered — got "${text}"`);
    }
    return asking(spec, pending, step, [...strokes, { kind: "point", point }], undefined);
  }
  return asking(spec, pending, step, [...strokes, { kind: "point", point: response.point }], undefined);
}

function applyOption(
  spec: CommandSpec,
  prompts: readonly PromptStep[],
  pending: PendingCommand,
  step: PromptStep,
  strokes: readonly PromptStroke[],
  option: PromptOption,
): CommandSession {
  switch (option.effect) {
    case "record":
      return asking(spec, pending, step, [...strokes, { kind: "option", option: option.name }], undefined);
    case "undo":
      return asking(spec, pending, step, strokes.slice(0, -1), undefined);
    case "end":
      return endsHere(spec, prompts, pending, step, [...strokes, { kind: "option", option: option.name }]);
    default: {
      const exhaustive: never = option.effect;
      void exhaustive;
      return asking(spec, pending, step, strokes, `${spec.name} declares a word this prompt cannot read`);
    }
  }
}

/** Closes a step that repeats and moves on, or says how many points it still needs. */
function endsHere(
  spec: CommandSpec,
  prompts: readonly PromptStep[],
  pending: PendingCommand,
  step: PromptStep,
  strokes: readonly PromptStroke[],
): CommandSession {
  const minimum = step.minimum ?? 0;
  const count = pointCount(strokes);
  if (count < minimum) {
    return asking(spec, pending, step, strokes, `${spec.name} needs at least ${minimum} points, and has ${count}`);
  }
  const answers: PromptAnswers = { ...pending.answers, [step.name]: strokes };
  return afterStep(spec, prompts, pending.stepIndex + 1, answers);
}

/** Asks the same step again, with the strokes it holds now. */
function asking(
  spec: CommandSpec,
  pending: PendingCommand,
  step: PromptStep,
  strokes: readonly PromptStroke[],
  error: string | undefined,
): CommandSession {
  const answers: PromptAnswers = { ...pending.answers, [step.name]: strokes };
  return {
    status: "prompting",
    pending: { commandName: spec.name, stepIndex: pending.stepIndex, answers },
    message: promptMessage(step, answers),
    error,
  };
}

/** The next step, or the command the answers build when no step remains. */
function afterStep(spec: CommandSpec, prompts: readonly PromptStep[], index: number, answers: PromptAnswers): CommandSession {
  const nextStep = prompts[index];
  if (nextStep === undefined) {
    const build = spec.buildFromPrompts;
    if (build === undefined) {
      return { status: "failed", message: `"${spec.name}" declares prompts but cannot build from them`, start: 0 };
    }
    return { status: "complete", command: build(answers) };
  }
  return {
    status: "prompting",
    pending: { commandName: spec.name, stepIndex: index, answers },
    message: promptMessage(nextStep, answers),
    error: undefined,
  };
}

export function cancelCommand(): CommandSession {
  return { status: "cancelled" };
}

/**
 * The line the operator reads. A step that repeats asks a different question
 * before its first answer. It also lists the words it takes, once they apply.
 */
export function promptMessage(step: PromptStep, answers: PromptAnswers = {}): string {
  if (step.repeats !== true) {
    return step.defaultValue === undefined ? `${step.message}:` : `${step.message} <${step.defaultValue}>:`;
  }
  const strokes = strokesOf(answers, step);
  const asked = strokes.length === 0 ? (step.firstMessage ?? step.message) : step.message;
  const offered = offeredOptions(step, strokes).map((option) => capitalised(option.name));
  return offered.length === 0 ? `${asked}:` : `${asked} or [${offered.join("/")}]:`;
}

function capitalised(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function strokesOf(answers: PromptAnswers, step: PromptStep): readonly PromptStroke[] {
  const found = answers[step.name];
  return Array.isArray(found) ? found : [];
}

function pointCount(strokes: readonly PromptStroke[]): number {
  return strokes.filter((stroke) => stroke.kind === "point").length;
}

/** The words the step takes right now. A word with a minimum waits for it. */
function offeredOptions(step: PromptStep, strokes: readonly PromptStroke[]): readonly PromptOption[] {
  const count = pointCount(strokes);
  return (step.options ?? []).filter((option) => count >= (option.needs ?? 0));
}

/**
 * The word a typed answer names. It takes the whole word, or the first letter
 * when one word alone starts with it. An ambiguous letter matches nothing.
 */
function matchOption(step: PromptStep, strokes: readonly PromptStroke[], text: string): PromptOption | undefined {
  const folded = text.toLowerCase();
  const offered = offeredOptions(step, strokes);
  const whole = offered.find((option) => option.name === folded);
  if (whole !== undefined) {
    return whole;
  }
  if (folded.length !== 1) {
    return undefined;
  }
  const starting = offered.filter((option) => option.name.startsWith(folded));
  return starting.length === 1 ? starting[0] : undefined;
}

type ResponseRead = { readonly ok: true; readonly value: PromptValue } | { readonly ok: false; readonly reason: string };

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
    return step.defaultValue === undefined ? { ok: false, reason: `${step.message} needs a value` } : { ok: true, value: step.defaultValue };
  }

  switch (step.accepts) {
    case "point": {
      const point = parsePointLiteral(text);
      return point === undefined ? { ok: false, reason: `${step.message} needs a point as x,y — got "${text}"` } : { ok: true, value: point };
    }
    case "distance": {
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

function asRead(distance: number | string): ResponseRead {
  return typeof distance === "string" ? { ok: false, reason: distance } : { ok: true, value: distance };
}

function distanceFrom(step: PromptStep, gathered: PromptAnswers, point: PromptPoint): number | string {
  const anchorName = step.relativeTo;
  if (anchorName === undefined) {
    return `${step.message} takes a typed number — it has no point to measure from`;
  }
  const anchor = gathered[anchorName];
  if (!isPromptPoint(anchor)) {
    return `${step.message} cannot measure from ${anchorName}, which is not a point`;
  }
  return Math.hypot(point.x - anchor.x, point.y - anchor.y);
}

function parsePointLiteral(text: string): PromptPoint | undefined {
  const separator = text.indexOf(",");
  if (separator < 0) {
    return undefined;
  }
  const x = parseCommandNumber(text.slice(0, separator).trim());
  const y = parseCommandNumber(text.slice(separator + 1).trim());
  return x === undefined || y === undefined ? undefined : { x, y };
}

function firstPrompt(commandName: string, prompts: readonly PromptStep[]): CommandSession {
  const step = prompts[0];
  if (step === undefined) {
    return { status: "failed", message: `"${commandName}" declares an empty prompt sequence`, start: 0 };
  }
  return {
    status: "prompting",
    pending: { commandName, stepIndex: 0, answers: {} },
    message: promptMessage(step, {}),
    error: undefined,
  };
}

function usesNamedForm(tokens: readonly { readonly text: string; readonly quoted: boolean }[]): boolean {
  return tokens.some((token) => !token.quoted && token.text.includes("="));
}

function fromParse(line: string): CommandSession {
  const result = parseCommand(line);
  return isCommandParseFailure(result) ? failed(result) : { status: "complete", command: result.command };
}

function failed(failure: CommandParseFailure): CommandSession {
  return { status: "failed", message: failure.message, start: failure.start };
}
