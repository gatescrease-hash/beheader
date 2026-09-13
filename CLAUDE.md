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
npm test                          # 2369 tests, all pass
npm run typecheck                 # both TypeScript configs
npm run build                     # production build
npm run prose                     # prose checker, gives exit code 0
```

## How to write a comment

A comment explains the code to a person who reads it for the first time. It
says what the code is and why it has this shape. It does not give orders to
whoever edits the file next.

Eight rules set the register. The checker enforces the ones a machine can
judge, and a person judges the rest.

1. **Describe the code. Do not direct the reader.** A limit appears as a fact
   about the code. Write "The file works on plain data alone", not "This file
   must never touch the DOM".
2. **Give every constraint its purpose.** A sentence that names a limit
   carries `so`, `because` or `which keeps` beside it. A rule with no reason
   is no help in the case that it did not predict.
3. **Write whole sentences.** Each one needs a subject and a verb. `Layer:
   engine.` and `Pure logic.` are labels, not sentences.
4. **State a fact once.** Cut the colourful version when the plain one is
   there. Cut an adjective that the noun already carries, such as "a stable ID
   that never changes".
5. **Use plain words.** "heavily relied upon" beats "load bearing". A domain
   term with an exact meaning stays.
6. **Let `never` and `every` describe behaviour, not duty.** "An ID never
   changes" is a fact about the code. "This file must never import the DOM" is
   an order to a reader.
7. **Open with what the file is.** The layer and the import limits come after,
   each with its reason beside it.
8. **Connect the sentences.** Where one idea causes the next, write the link.

The mechanics of Simplified Technical English still hold:

- Keep a sentence to 25 words.
- Use the active voice. Name the actor.
- Put one idea in one sentence.
- Do not use a verb in the -ing form.
- Do not use `must`, or the four vague modals `should`, `could`, `would` and
  `may`. A comment has no duties to hand out.
- Do not use a semicolon, a long dash, a contraction, or capitals for emphasis.

A file header answers three questions in about ten lines:

- What does this file do?
- What layer is it in, and what can it import, and why?
- What surprise waits for a reader who changes it?

Then read the header again and cut it. Ask of each sentence whether the file
still explains itself without it, and whether a shorter word carries the same
meaning. Length that survives this second pass has earned its place.

Do not write the history of a decision in a comment. The purpose of the code
belongs there, because it is still true. The story of how the code reached
that shape belongs in `docs/STATUS.md`. Do not quote a section number from a
document.

Write a comment only where the code cannot speak for itself. Read the file as
if you have never seen it, and ask of each function whether its name and its
body already answer the question. A comment that repeats the next line is
noise. A comment that gives the reason behind a choice the code cannot state
is worth the space.

## When the spec is silent

Prefer, in this order:

1. Whatever keeps `engine/` free of the DOM.
2. Whatever keeps graph state plain and serializable.
3. Whatever protects Rule 4.
4. Whatever is simplest to delete later.
