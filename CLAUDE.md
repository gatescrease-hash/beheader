# CLAUDE.md

Read `docs/STATUS.md` first. It holds the state of the code and the structure
map of the repository. `docs/TODO.md` holds the open work, and it is where a
change starts. Read `docs/SPEC.md` when you need to know what the product must
do.

`docs/STYLE.md` holds the rules for prose, and one worked example of a file
header written badly and then written well. Read it before you write a comment.

Those four files are the only project documents. Do not add a fifth without a
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

1. Pick one item from `docs/TODO.md`.
2. Write the code and the tests together.
3. Run the checks below. All must be clean.
4. Delete the item from `docs/TODO.md` when it lands, and update the state
   table in `docs/STATUS.md` where the change moves it.

```
npm test                          # 2369 tests, all pass
npm run typecheck                 # both TypeScript configs
npm run build                     # production build
npm run prose                     # prose checker, gives exit code 0
```

## How to write a comment

`docs/STYLE.md` holds the rules and the worked example. Read the example first.
It shows the same header written badly and then written well, with the reason
for each change.

The short version. Describe the code, and do not direct the reader. Give every
constraint its reason. State a concrete property rather than a value judgment.
Carry a negative with a preposition: "with no snapshots", not "it keeps no
snapshot". Do not announce a count before the content. Clarity beats brevity,
and there is no word limit.

`npm run prose` checks the rules a machine can judge. A person judges the rest
against the example in `docs/STYLE.md`.

This repository used to hold its prose to ASD-STE100 Simplified Technical
English. Section 5 of `docs/STYLE.md` says why that is gone.

## When the spec is silent

Prefer, in this order:

1. Whatever keeps `engine/` free of the DOM.
2. Whatever keeps graph state plain and serializable.
3. Whatever protects Rule 4.
4. Whatever is simplest to delete later.
