# 0070 — AutoCAD-style command prompting, and D-071's formula path
Date: 2026-08-25   Phase: 3   Model: Claude Opus 5 (**reviewer, implementing on human direction**)
Previous entry: 0069-REVIEW-phase3   Last review: 0069-REVIEW-phase3 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; ~962 lines / 5 files changed.

## Process note, stated first because it is a deviation

`PROCESS_BRIEF.md` §1 says the reviewer "does not do bulk implementation." This cycle is bulk
implementation written by the reviewer, on the human's explicit direction ("Implement it as best as
possible"). Flagging it rather than letting the role blur silently: the human routes work and may
route it here, but the next cycle should go back to an implementer, and **this cycle has had no
independent review** — the usual second pair of eyes did not happen, which is exactly the value the
role split exists to produce. Treat §6.1 as fired and review it before the next slice.

## Declared scope

Two things the human ruled at 0069-REVIEW's hand-off: **D-071** (`set <address> = <formula source>`,
answering Q-013 as option (a)) and **D-072** (a command word typed alone enters an AutoCAD-style
prompt sequence; every prompt takes a typed value or a picked point). Both are parsing-layer work:
`command/parser.ts` grows a formula path and a `prompts` field, and the new `command/prompt.ts`
drives the sequences.

## Explicitly not in scope

- **`command/commands.ts`** — still unwritten. Nothing here resolves a name, builds an `Operation`,
  or calls `mutate`, and no formula is parsed: `set … = …` captures source text and stops.
  **D-070's count bounds are therefore still owed and still due in that cycle.**
- **`main.ts`** — no listener, no canvas, no camera clamp. Nothing here converts a screen click to
  a world point; the machine takes world points already converted.
- **Object-selection prompts** (`select`/`delete`/`refs` prompting "select an object"). They need a
  pick resolved through `render/hittest.ts` against a document. Deferred in D-072 explicitly, and
  the deferral is written into `prompt.ts`'s NOT DONE HERE with its owner.
- **Rubber-band preview between picks.** That is §5.9's visual feedback and D-068 binds it to one
  cycle in the renderer. `prompt.ts` reports which step is live; it draws nothing.
- Every carried known problem in `STATUS.md`. None was touched.

## What I did

### `src/command/parser.ts` (+265/-39) — D-071 and D-072's registry half

**D-071, the formula path.** `SetCommand` split into `SetLiteralCommand` (`kind: "set"`, unchanged)
and `SetFormulaCommand` (`kind: "set-formula"`, carrying `source`). A new positional kind,
`literal-or-formula`, marks the one position where a leading `=` means "the rest of the LINE is a
formula" — taken as `line.slice(token.start)`, before tokens are distributed, because the tokens
after the `=` belong to the formula and not to the command. `matchArguments` now takes the whole
`line` rather than just its length, which is what makes the raw substring possible at all.

Everywhere else a leading `=` is still refused, but **only where a malformed `key=value` cannot
already explain it better**: `circle =1` now reports `"=1" is not a key=value argument` instead of
the formula message, which incidentally closes 0069-REVIEW fix-list item 3.

**D-072, the registry half.** `CommandSpec` grows optional `prompts` and `buildFromPrompts`. A
command with neither behaves exactly as it did — which is every non-creation command. The four
creation commands declare sequences:

| command | steps |
| --- | --- |
| `circle` | centre (point) → radius (distance from centre) |
| `polygon` | sides (number) → centre (point) → radius (distance from centre) |
| `rect` | first corner (point) → opposite corner (point) |
| `table` | origin (point) → rows (number, `<8>`) → cols (number, `<8>`) |

Also exported for `prompt.ts`: `findCommandSpec`, `parseCommandNumber`, `tokenizeCommandLine`. All
three exist so the second file reads the SAME registry and the SAME number and quoting rules rather
than keeping a copy — D-043's drift argument, and D-072 clause 2's "adding a command is still one
registry entry."

### `src/command/prompt.ts` (new, 332 lines) — D-072's machine

Three pure functions over a plain `PendingCommand`: `beginCommand(line)`, `respond(pending,
response)`, `cancelCommand()`. A response is `{kind:"typed", text}` or `{kind:"picked", point}`.
The session comes back as `complete` / `prompting` / `failed` / `cancelled`.

`PendingCommand` is `{ commandName, stepIndex, answers }` — plain and serializable, with the spec
looked up from the name on every call rather than held, so no closure or live object reference is
ever in it. A test round-trips it through `JSON.stringify` to pin that.

### `src/command/prompt.test.ts` (new, 250 lines, 32 tests) and `parser.test.ts` (+59/-19)

`EQUIVALENT_FORMS` is the load-bearing block: one entry per prompting command holding §5.10's typed
line and the same command answered step by step, with a coverage assertion that fails if a command
grows prompts without an entry. That is what pins D-072 clause 3 — both forms MUST produce the
identical `Command` — rather than trusting two `build` functions to agree.

## Decisions I made

**1. A line is a sequence of prompt responses, not a special "bare word" case.** `circle`,
`circle 100,100` and `circle 100,100 20` are one command at three stages. This is AutoCAD's
space-is-Enter behaviour, and taking it literally is what makes partial input fall out instead of
needing its own branch. The alternative — only a *bare* word enters prompting — would have needed a
separate "some arguments but not enough" path, which is the case operators hit most.

**2. §5.10's `key=value` form is routed to `parseCommand` explicitly, not left to fall through.**
See "Where I got stuck" #1: a mutation check proved this guard changes no behaviour today. I kept
it anyway and wrote the hazard into the code. It is the one place in this cycle I chose legibility
over the smaller diff, and §13's ordering (smaller diff first) says that needs justifying — the
justification is that the fallback holds only while no prompt step accepts arbitrary text.

**3. A refused answer re-prompts the same step and keeps everything gathered.** D-072 clause 7, and
the behaviour I would most defend: losing three picks to a mistyped fourth is the difference between
a tool and a demo. Only `cancelCommand()` discards.

**4. The typed point literal is `x,y`, taken from the brief.** §5.10 already writes
`polyline 0,0 100,0 100,100` and `addvertex polyline_1 100,100`. I did not invent a point syntax and
did not add AutoCAD's relative `@10,10` — §5.10 shows none, Rule 5 governs, and it is additive later.

**5. A typed point is accepted at a `distance` step.** `circle`, centre `0,0`, then `0,50` gives
radius 50 — the same reading a pick gets. AutoCAD does this and it costs three lines.

**6. `rect` normalises its two corners** (`min`/`abs`). The preset is corner-anchored and `#TYPE`s a
negative width or height (`primitives/geometry.ts`), so without normalising, a pick up-and-left would
draw an error value instead of a rectangle. Pinned by a test that asserts both pick orders agree.

**7. Bounds stay out of this file.** `polygon` with `sides=2.5` and a negative radius still complete
here, and a test says so naming D-070. D-069 and D-031 clause 3 both put that in the handler, and
D-070 rules where it lands. Putting a bound here would have been the third definition of it.

**8. `set … = …` with nothing after the `=` is refused HERE.** "You typed nothing" is arity, which
D-069 makes mine; "is this a valid formula" is `parseFormula`'s and is not pre-checked.

## Verification (real output)

```
$ npx tsc --noEmit                          exit 0, no output
$ npx tsc --noEmit -p tsconfig.engine.json  exit 0, no output
$ npx vitest run
 Test Files  22 passed (22)
      Tests  874 passed (874)
$ grep -rn "\.only(|\.skip(|it\.todo|describe\.todo" src/    (no output)
```

874 = 837 (0069-REVIEW's post-edit count) + 32 prompt tests + 5 net new parser tests.

### Mutation check (D-016's practice)

The prompt suite passed on its first run. Six load-bearing lines neutralised one at a time:

| Neutralised | Result |
| --- | --- |
| `Math.hypot` distance → `0` | caught (5 tests, incl. both `circle` and `polygon` equivalence) |
| refused answer advances the step | caught ("does not abandon the command…", "accepts the retry…") |
| empty answer no longer takes the default | caught (`table` equivalence + "refuses an empty answer…") |
| a pick accepted at a `number` step | caught ("refuses a pick where only a typed number means anything") |
| `rect`'s `min`/`abs` normalisation | caught (both `rect` tests) |
| formula source re-joined from tokens | caught ("carries the RAW substring…") |
| **`usesNamedForm` → always false** | **SURVIVED — see "Where I got stuck" #1** |

**My first mutation run reported all seven as surviving and that was wrong** — the detector grepped
for `^\s+× ` against vitest's ANSI-coloured output, so it never matched a failure. Caught it because
seven-for-seven was implausible, not because the script said anything. Recording it because a
mutation check that silently always passes is worse than none: it certifies whatever you point it at.

## Acceptance criteria status

Phase 3 criterion: *"you can create a polygon and a table by command, see both drawn, pan/zoom,
select, and drag the polygon."* — **NOT YET, and not closer to the "see both drawn" half.** `polygon`
and `table` can now be *composed* by pointing rather than typing, but nothing executes a `Command`
and no pixel has ever come from one. `commands.ts` and `main.ts` are both still missing. Nothing
here is claimed as passing.

## Where I got stuck / what is unfinished

**1. One mutant survived, and I kept the code it proved redundant.** Neutralising `usesNamedForm` to
`return false` broke no test, because `circle x=100 y=100 r=20` then goes down the prompt path,
fails the point step on `x=100`, and gets rescued by the "a token the sequence could not read"
fallback into `parseCommand`. So §5.10's documented form is currently served correctly by *two*
paths. I could not write a test that distinguishes them — there is no behavioural difference today.
I kept the guard and wrote the reason into the code as a hazard note: the accident holds only while
no prompt step accepts arbitrary text, and the first `text`-accepting step would swallow `x=100` as
an answer. **A reviewer who disagrees should delete `usesNamedForm` and the note together**; I would
not argue hard, and it is four lines.

**2. The prompt sequences are my reading of AutoCAD, not the brief's.** §5.10 gives no prompt order,
no prompt wording, and no point syntax for anything but `polyline`. `polygon` asking for sides
before the centre is AutoCAD's POLYGON order; `rect` taking two corners is RECTANG; the `<8>`
default form is AutoCAD's. These are all cheap to change and none is load-bearing, but they are
choices, not derivations, and the human should say if any reads wrong in use.

**3. No end-to-end proof exists that this is usable**, because nothing runs. Every test here drives
the machine through function calls. Whether the sequence *feels* right — whether "specify radius:"
should show the running distance, whether Enter should repeat the last command as AutoCAD's does —
cannot be known until `main.ts` puts it on screen. I did not build a repeat-last-command gesture,
which AutoCAD has and operators lean on heavily; it needs the input bar to exist first.

**4. `prompt.ts`'s header is 52 lines** against §5.2's 20-40. Same unresolved budget problem as entry
0065 and 0069-REVIEW §7. It is under `parser.ts`'s 65 and every line is keep-always material
(invariants, two deferrals with owners, the world-point hazard).

**5. I changed two existing test expectations** beyond the Q-013 block D-071 pre-authorised: the
`set` usage string appears in one message, and `circle =1 y=0 r=1` now gets the better keyless-pair
message. Both are consequences of D-071, neither weakens what the test pins, and §6.1 trigger 5 is
declared below rather than absorbed.

**6. `set-formula` is a second `kind` for one command word.** `Command`'s union now has an arm whose
`kind` is not a registry name, which the "every registered command has an example" coverage test
does not cover (it maps registry names, and `set-formula` is not one). A handler switch will still
be exhaustive because TypeScript checks the union, but the *test* symmetry is weaker here than
elsewhere in this file. The alternative — one `set` arm with an optional `formula` field — makes
every consumer check a field instead of a discriminant, which D-032's principle argues against.

## Open questions raised

None. **Q-013 is ANSWERED (D-071)** and its `PROVISIONAL(Q-013)` tag is gone — grepped, the single
site in `matchArguments` is now the formula path itself. Q-012 and Q-008 are untouched.

## Review point

Fired: **§6.1 trigger 3** (D-072 extends §5.10, which shows only complete one-line forms — an
authorised extension, but an extension) and **§6.1 trigger 5** (changed test expectations, in the
Q-013 block D-071 pre-authorised plus the two in "stuck" #5). **Also: this cycle was written by the
reviewer and has had no independent review** — see the process note at the top.

Cycles since last review: 1/3 · diff since last review: ~962 lines / 5 files (cap 800/10 —
**exceeded on lines**).
