# CLAUDE.md

You are an **implementer** on this project. Read this file, then follow it exactly.

## Before writing any code, read in this order

1. `PROJECT_BRIEF.md` — the specification. All of it. Every session, including this one.
2. `PROCESS_BRIEF.md` — how work is done here. All of it.
3. `claude/STATUS.md` — where the project actually is right now.
4. `claude/DECISIONS.md` — binding rulings that extend the brief.
5. `claude/OPEN_QUESTIONS.md` — known ambiguities. Do not settle one by accident.
6. The most recent `claude/entries/*-REVIEW-*.md` and every entry after it.

Do **not** read all of `claude/entries/` to get oriented. `STATUS.md` is for that.

## The cycle

Orient → declare your slice → check the review gate → implement with tests → **actually run**
typecheck and tests → write a new numbered log entry → rewrite `STATUS.md` → self-assess and
end with the cycle summary block (`PROCESS_BRIEF.md` §11.3).

Finish your declared slice before starting the next. You may complete more than one slice before
review is required — see `PROCESS_BRIEF.md` §6 for exactly when to stop and hand off.

## Non-negotiables

- `src/engine/` never touches the DOM, `window`, `document`, a canvas, or `src/render/`.
  Text measurement comes in through the injected `TextMeasurer` interface.
- All state change goes through `src/engine/mutation.ts`. Nothing else mutates document state.
- Graph state is plain and serializable. IDs, not object references. No closures, class
  instances, or `Map`s of live objects.
- Performance is a non-goal. Build the dumbest correct implementation the brief specifies.
- Never weaken, skip, or delete a test to reach green. That is an escalation.
- Never build anything in `PROJECT_BRIEF.md` §8.
- Never claim an acceptance criterion passes without an executable test proving it.

## When you are unsure

Raise a question in `OPEN_QUESTIONS.md` rather than guessing. If a provisional choice is
reversible, take it and tag every site `// PROVISIONAL(Q-NNN)`. If it is not reversible —
anything shaping the data model, addressing, or the mutation sequence — stop the cycle and
escalate.

## Commands

```
npx tsc --noEmit     # must be clean at end of every cycle
npm test             # must pass, zero skipped, zero .only
```

## Escalate now (don't wait for the batch cap) when

Any `PROCESS_BRIEF.md` §6.1 trigger fires: a phase gate, the first file of a new subsystem, any
brief deviation or ambiguity, a hard rule you couldn't satisfy cleanly, a changed test
expectation, a new dependency/build step/config file, or a second failed attempt at the same bug.
Otherwise, ongoing work on a load-bearing file (`address.ts`, `mutation.ts`, `graph/*`,
`primitives/schema.ts`, `document.ts`) may continue across up to 3 cycles or ~800 changed lines
before a review point is mandatory (§6.3) — state the running total in your log entry.

Triggers are objective. Apply them honestly rather than by how confident you feel.

An honest, unfinished cycle with a clear log is worth more than a polished cycle that
misreports itself.
