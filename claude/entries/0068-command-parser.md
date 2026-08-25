# 0068 — command/parser.ts: command string → command object
Date: 2026-08-25   Phase: 3   Model: Claude Opus 5 (implementer)
Previous entry: 0067-REVIEW-phase3   Last review: 0067-REVIEW-phase3 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; ~1103 lines / 4 files changed so far — **over §6.3's
~800-line cap in this one cycle**, see "Review point" below.

## Declared scope

`command/parser.ts` and its tests: §5.10's parsing half only — a typed command line becomes a
typed command object, or a failure naming what is wrong and where. Sixteen of §5.10's commands get
a registry entry; the rest are listed by name as specified-but-not-built.

## Explicitly not in scope

- **`command/commands.ts`** — every handler. Nothing here resolves a name to an id, builds an
  `Operation`, or calls `mutate`. That is the next slice and it is where D-040/D-041 actually bite.
- **`main.ts`** — the input bar, the echo log §5.10 asks for above it, event wiring, and D-062's
  camera clamp (0067-REVIEW §10 carry-ins 1 and 2). Untouched except for one comment (below).
- **`pan`** — §5.10 lists it with no argument grammar, and a typed `pan <dx> <dy>` would have to
  decide world units vs. screen pixels, which is **Q-012's** open question. Left out deliberately
  rather than invented; the file header and `COMMANDS_SPECIFIED_BUT_NOT_BUILT` both say so.
- **`polyline`/`text`/`script`/`image` creation, `explode`, `addvertex`, `delvertex`** — each waits
  on a schema or an `Operation` kind that does not exist.
- Every carried known problem in STATUS.md. None was touched.

## What I did

### `src/command/parser.ts` (new, 801 lines) — §5.10

`parseCommand(line)` tokenises, looks the first word up in a private `COMMAND_SPECS` table, matches
the remaining tokens against that entry's declared arguments, and returns
`{ ok: true, command }` or `{ ok: false, message, start }`. Never throws.

- **Table-driven, as §5.10 requires.** One entry declares a command's `name`, `usage`, positional
  parameters, `key=value` parameters, flags, and a two-line `build`. One shared `matchArguments`
  does all grammar work, so every command's arity/unknown-key/bad-number message has the same
  shape. Adding a command is one entry plus one `Command` arm; there is no dispatch switch here.
- **Sixteen commands:** `circle`, `polygon`, `rect`, `table`, `link`, `unlink`, `set`, `rename`,
  `delete [force]`, `refs`, `list`, `select`, `zoom`, `fit`, `save`, `load`.
- **`Command` is a discriminated union**, `kind` being the command word verbatim, widened the way
  `mutation.ts`'s `Operation` is widened (Q-005/D-020: widen, never restructure).
- `COMMAND_NAMES` and `COMMANDS_SPECIFIED_BUT_NOT_BUILT` are exported; a test pins them disjoint.

### `src/command/parser.test.ts` (new, 284 lines) — 59 tests

`DOCUMENTED_EXAMPLES` holds §5.10's own example line for every registered command, with a coverage
assertion that fails if an entry lands without one. No document fixture appears anywhere in the
file, which is the point: every test is a claim about grammar alone.

### Two comment-only edits, both owed under D-065

My work falsified two cross-file claims, so they are mine (D-065), not a drive-by:

- `src/main.ts` — said "there is no `command/`, so nothing can create an object". `command/` now
  exists. Rewritten to state what is missing on **main.ts's own side** (no listener, no handler),
  which is D-065's preventive half: a sentence about this file rather than an inventory of the tree.
- `src/engine/primitives/table.ts` — said a table-creation command's missing piece "is the command
  word, not an engine primitive". The word now parses; the handler is what is missing. Also
  `DEFAULT_TABLE_ROWS`/`DEFAULT_TABLE_COLS`'s doc comment, which said "a future table-creation
  mutation reads these" — `command/parser.ts` reads them now, and the comment names it.

Four other command-layer claims were checked and are **not** falsified, so I left them alone:
`document.ts:87`, `mutation.ts:146` and `primitives/schema.ts:78` all say allocating a fresh id and
choosing default slot values is a future command-layer concern — still true, no handler exists;
`renderer.ts:33`'s "a reorder command that does not exist" is still true (§5.10 has no reorder).

## Decisions I made

**1. The parser resolves nothing, and takes no document.** A `Command` carries the names and
address strings the operator typed, verbatim. `parseAddress`, `checkNameAvailable`, `Operation`
building and `mutate` are `commands.ts`'s, which has the document. §5.2's "names resolve to IDs at
parse time" governs a **stored AST**; a command object is transient input to resolution, never
stored and never journaled, so a name here breaks no invariant. The rejected alternative — pass the
object list in and resolve here — splits resolution in two, because a creation command's fresh id
and default name come from `nextObjectId`, which lives in the document this file would still not
have. This is the one design choice in the slice I most want checked, and it contradicts a carry-in
(see "Where I got stuck").

**2. Grammar failures here; identity failures there.** How many arguments, which keys, whether a
token is a number: mine. No object of that name, a name already taken, a slot that does not exist:
not mine. So `set polygon_1 42` (no dot) and `rename polygon_1 3bad` (ungrammatical name) both
PARSE. This follows `address.ts`'s own L-4 precedent (0002-REVIEW-phase0), which deliberately
declines to pre-check a name against `NAME_PATTERN` for exactly this reason: one failure path per
problem, owned by the file that owns the form. Re-checking the address form here would have been a
second definition of it — the drift D-043 rules against.

**3. Quoting decides type.** `set v.x 42` writes the number, `set v.x "42"` writes the string. A
quoted token is therefore refused wherever a number is declared (`zoom "2"` fails), and a token is
either a bare word or a WHOLE quoted string — a quote inside a bare word is rejected rather than
given shell-like concatenation. The alternative (quote anywhere, concatenate runs) makes the one
thing quoting decides depend on where the quote sits inside a word.

**4. Booleans are exact-uppercase `TRUE`/`FALSE`**, matching `lexer.ts`'s own rule (§5.3), so one
spelling serves both surfaces. Widening to accept `true` later breaks nothing.

**5. The number form is §5.3's `[0-9]+(\.[0-9]+)?` plus a sign.** The sign is the one addition and
it is needed: a formula gets a negative from its unary-minus operator and a command line has no
operators, so `set polygon_1.origin.x -50` would otherwise be unwritable. No exponent form —
§5.10 shows none, and adding one later is additive.

**6. A non-finite number produced here is NOT refused here.** `set v.x <401 digits>` yields
`Infinity` in the command object and `mutate` refuses it (D-025). D-031 clause 3 is explicit that a
text-scanning stage is not the place to enforce document-state policy; the same reasoning binds
`-0` (Q-008 option (a) lives in `mutate`). Both are pinned by tests that name the rulings.

**7. Positionals fill before flags are considered**, so `delete force` deletes the object *named*
`force` and `delete force force` deletes it down §5.1.1's repair path. The reverse order makes an
object named `force` undeletable, which is a silent trap; this ordering has no downside I can find.

**8. `table`'s `rows`/`cols` default to §5.4's 8×8, imported from `primitives/table.ts`** rather
than re-spelled — D-010's "declare vocabulary once". The other creation arguments are all required:
§5.10 writes them out, strictness is additively widenable (D-037's stance), and a default position
of `(0,0)` is a creation-semantics choice that belongs to the handler if anyone wants it.

**9. A §5.10 command with no entry yet reports "not built", not "unknown command"** — the latter is
false, and D-042 says argue from correctness. The two lists being disjoint is pinned by a test, so
moving a name into the registry without removing it from the other list fails the suite rather than
shipping a wrong message.

**10. Command words and `key=value` keys match case-insensitively; argument VALUES never do.**
§5.2 already folds case for object-name lookup and D-039 does for cell references, so a
case-sensitive command word would be the odd one out — but folding a value would duplicate
normalisation that `findObjectByName` and D-043 already own.

## Verification (real output)

```
$ npx tsc --noEmit
ROOT CONFIG CLEAN                       (no output, exit 0)

$ npx tsc --noEmit -p tsconfig.engine.json
ENGINE CONFIG CLEAN                     (no output, exit 0)

$ npx vitest run
 ✓ src/command/parser.test.ts (59 tests) 13ms
 ... 21 files ...
 Test Files  21 passed (21)
      Tests  835 passed (835)

$ grep -rn "\.only\|\.skip\|it\.todo\|describe\.todo" src/
(no output)
```

835 = 776 (0067-REVIEW's post-edit count) + 59.

### Mutation check (D-016 clause 1's practice, applied to the six load-bearing lines)

The suite passed on its first run, which is exactly when it is worth checking that it discriminates.
Six lines neutralised one at a time, suite re-run each time; every mutant was caught by a **named**
test:

| Neutralised | Test that failed |
| --- | --- |
| flags considered before positionals fill | "fills the positional argument before the flag, so an object actually named force is still deletable" |
| the leading-`=` guard | "refuses an argument that begins with = and says where a binding comes from instead" (+2 more) |
| `token.quoted` in the number reader | "refuses a quoted number where a number is declared, because quoting means the value is text" |
| the named-argument default | "applies §5.4's 8x8 default when rows and cols are omitted..." (+1 more) |
| the duplicate-key check | "rejects a key given twice rather than quietly taking the last one" |
| `token.quoted` in the literal reader | "keeps a double-quoted argument whole, spaces included" (+3 more) |

No mutant survived. The script is in the scratchpad, not the repo.

## Acceptance criteria status

Phase 3 criterion: *"you can create a polygon and a table by command, see both drawn, pan/zoom,
select, and drag the polygon."* — **NOT YET.** This cycle makes `polygon sides=5 x=0 y=0 r=50` and
`table x=0 y=0 rows=8 cols=8` parse into command objects; nothing executes one. `commands.ts` and
`main.ts` are both still missing, and no test in this repo puts a pixel on a screen from a typed
line. Nothing here is claimed as passing.

## Where I got stuck / what is unfinished

**1. I contradicted a carry-in from 0067-REVIEW, deliberately.** §10 item 4 says "`command/
parser.ts` is the first consumer of `parseFormula` from a user surface" and to read D-038 before
writing it. I read D-038 and then did not call `parseFormula` at all, because **no §5.10 command
takes a formula**: `link` takes two addresses (§5.1's degenerate formula is built from a resolved
address, not parsed), `set` is shown writing a literal, and `text`'s content is a literal slot whose
block tree is Phase 5's. The formula surface §5.4 names is the formula bar, which is unbuilt render
work. So D-038's four conditions come due at whichever file first calls `parseFormula` — probably
`commands.ts` if Q-013 lands as (a), otherwise the formula-bar cycle. **If the reviewer disagrees,
this is a REVISE and I will take it**; the design absorbs the other answer cheaply, because a
formula-taking `set` would carry the raw SOURCE text in the command object and let `commands.ts`
parse it, which keeps this file document-free either way (and satisfies D-038 clause 4 for free —
the rejected source is never discarded).

**2. This one cycle is over §6.3's ~800-line cap on its own** (~1103 lines, 4 files). It is one
module plus its tests, which is §3's own definition of a slice, and roughly two thirds of
`parser.ts` is declaration — 16 command interfaces and 16 registry entries — rather than logic. I
considered splitting it into "the mechanism plus six commands" then "the remaining ten", and judged
that worse: the second cycle would be nothing but registry entries, and the design question the
reviewer actually needs to check (decision 1) would be settled in the first either way. Stating it
rather than hiding it; the cap fires and review was already required.

**3. The header is 65 lines against §5.2's 20-40 for an ordinary file.** Every line is §5.2's
keep-always material (two rejected alternatives, five invariants, five deferrals each naming an
owner, one hazard-shaped rule about quoting). This is entry 0065's unresolved budget problem again,
now with a fresh data point: a subsystem's first file cannot state its own contract in 40 lines in
this codebase. I did not trim below what the next model needs.

**4. Three things about the registry I am not confident in, all cheap to change.** `zoom`/`fit` are
in and `pan` is out, which reads oddly until you know why (its argument units are Q-012's). `refs`
takes one `text` argument for both `<object>` and `<slot>` forms, because the parser cannot tell
them apart without resolving. And `usage` strings are the only place a `<name>` and an `<address>`
argument differ — the matcher treats both as `text`, which is honest but means the usage line is
doing documentation work the types are not.

**5. No end-to-end test through a command exists yet**, so 0067-REVIEW fix-list item 2 (owed by
`renderer`, `hittest`, `interaction`) is untouched and stays owed — it needs the handler, not the
parser.

**6. `STATUS.md` is 162 lines against §2's "keep < 150".** A new subsystem, a new open question and
a new known problem all landed at once. I compressed *Known problems* to §11.2's own one-line-each
shape, and cut the gotchas that merely restated `DECISIONS.md` entries down to a pointer — which the
*Settled* section already says is the right form ("binds without restatement here"). Everything
still there is a live carry-in with an owner; cutting further would drop one. Flagging the overrun
rather than hiding it, since the next model reads this file first.

## Open questions raised

**Q-013 — How is a general formula (`= polygon_b.origin.x * 2`) authored, given §5.10 has no
command for it and Phase 4(b) requires one?** Provisional choice: refuse any argument beginning with
`=`, with a message naming `link` and the question. Reversible — accepting `=` later changes the
meaning of nothing that parses today. Tagged at: `src/command/parser.ts` (`matchArguments`'s
formula guard). Full text in `OPEN_QUESTIONS.md`.

## Review point

Fired: **§6.1 trigger 2** (first file of the `command/` subsystem) and **§6.3's diff cap**
(~1103 lines in one cycle, against ~800). Also worth the reviewer's attention as a **trigger 3**
disclosure: §5.10 is silent on `pan`'s arguments, which is why `pan` is absent rather than invented.

Cycles since last review: 1/3 · diff since last review: ~1103 lines / 4 files (cap 800/10 —
**exceeded on lines**).
