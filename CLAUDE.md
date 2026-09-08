# CLAUDE.md

Read `docs/STATUS.md` first. It holds the state of the code, the structure map
of the repository, and the list of open work. Read `docs/SPEC.md` when you need
to know what the product must do.

Those two files are the only project documents. Do not add a third without a
reason. Do not write a log entry for each change. Git holds the history.

## What this is

Graphpaper is a spatial canvas. Every object on it is a live node in one shared
dependency graph. A table cell can drive a polygon. A polygon can drive a table
cell. Text can read both.

## Hard rules

These six rules make the design work. Do not break one for convenience.

1. `src/engine/` is pure logic. It must not touch the DOM, `window`,
   `document`, a canvas or `src/render/`. Text measurement comes in through the
   injected `TextMeasurer` interface.
2. All state change goes through `mutate` in `src/engine/mutation.ts`. No other
   code writes document state.
3. Graph state is plain data. Use IDs, not object references. Do not put a
   closure, a class instance or a live `Map` into graph state.
4. Evaluation never changes the slot set. Only a mutation adds or removes a
   slot.
5. Speed is not a goal. Write the simplest correct code.
6. Never weaken, skip or delete a test to get a green run.

## How to work

1. Pick one item from section 5 of `docs/STATUS.md`.
2. Write the code and the tests together.
3. Run the checks below. All must be clean.
4. Update section 5 of `docs/STATUS.md` when the item lands.

```
npm test                          # 1955 tests, all must pass
npm run typecheck                 # both TypeScript configs
npm run build                     # production build
npm run prose                     # prose checker, must give exit code 0
```

## How to write a comment

All prose in this repository follows ASD-STE100 Simplified Technical English.
The checker enforces it.

- Keep a sentence to 20 words for an instruction and 25 for a description.
- Use the active voice. Name the actor.
- Put one idea in one sentence.
- Do not use a verb in the -ing form.
- Use `must` for a duty and `can` for an ability. Avoid the four vague
  modals: `should`, `could`, `would` and `may`.
- Do not use a semicolon, a long dash, a contraction, or capitals for emphasis.

A file header answers three questions in about ten lines:

- What does this file do?
- What layer is it in, and what can it import?
- What trap must a reader know about?

Do not write the history of a decision in a comment. Do not quote a section
number from a document. `docs/STATUS.md` holds the reasons. A comment states a
fact about the code as it is now.

Write a comment only where the code cannot speak for itself. A comment that
repeats the next line is noise.

## When the spec is silent

Prefer, in this order:

1. Whatever keeps `engine/` free of the DOM.
2. Whatever keeps graph state plain and serializable.
3. Whatever protects Rule 4.
4. Whatever is simplest to delete later.
