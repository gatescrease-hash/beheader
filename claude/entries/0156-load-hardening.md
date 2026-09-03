# 0156 — load hardening: D-126 + D-127 + D-108, one `document.ts` boundary

Date: 2026-09-02   Phase: 5   Model: Opus 5 (implementer)
Previous entry: 0155-table-cell-fixes   Last review: 0150-REVIEW-phase5 (verdict: ACCEPT)
Batch: **not batched.** ~330 added / ~10 removed across 5 files, no new files.

**REVIEW: REQUIRED** — `document.ts` is §6.2 load-bearing and **D-127 clause 4 names this trigger
explicitly.** The human's standing instruction for this session is *"Skip the typical review process
and go right to making code changes... review your own work with tests"*, restated as *"over-rule the
brief and rules to actually get work done this cycle."* So the handoff is NOT taken and this cycle
self-reviewed with tests — but the trigger is recorded rather than quietly dropped, because a
reviewer picking this up later needs to know it fired.

## The instruction this implements

The human asked, after the table fixes: *"in the interest of time, also try and grab the next slice
or multiple slices of work... Prioritize making progress with implementing features while also
reviewing your own work."* `STATUS.md` names the next slice unambiguously and has for six entries:
the load-hardening cycle, discharging **D-126** + **D-127** + **D-108**, one `document.ts` diff.

## Declared scope

D-127 clause 5 lists the visible diff, and this entry is exactly that list:

1. boundary validation of a loaded `FormulaAst`'s shape (D-108 clause 2);
2. `document.test.ts` extended to D-108 clause 1's four shapes (that ruling's own owed
   reconciliation);
3. D-126's schema-driven derived-slot reconstruction, plus its round-trip test;
4. `openDocument`'s promise chain given a rejection path;
5. the two false "never throws" doc claims corrected (D-108 clause 1).

## What I did

### 1 + 2 — the AST shape validation (D-108 clause 2, owner D-127)

`reconstructSlot` did `raw.ast as FormulaAst`. An unchecked cast at the one boundary where the data
comes from outside the program. Four shapes D-108 named — `ast: null`, a `binaryOp` with `null`
children, a `binaryOp` with absent children, a `functionCall` whose `args` is not an array — threw a
`TypeError` straight out of `loadDocument`. **And because `main.ts`'s `openDocument` called it inside
`file.text().then(...)`, that became an unhandled promise rejection: no refusal, no log line, the
program simply did nothing** (D-127 clause 2). The operator's file did not load and nothing told them
why.

`validateFormulaAstShape` (new, in `formula/ast.ts`) walks arbitrary `unknown` against `FormulaAst`'s
seven variants and returns either the well-formed AST or a reason. Three decisions worth stating:

- **It lives in `ast.ts`, not `document.ts`.** It is knowledge about `FormulaAst`'s own variants: a
  new node type must join this walk in the same edit that adds it to the union, and side-by-side is
  the only thing that makes that obvious. `exceedsMaxFormulaAstDepth` sits there for the same reason.
- **`BinaryOperator`/`UnaryOperator` are now derived FROM runtime arrays** (`BINARY_OPERATORS`,
  `UNARY_OPERATORS`) rather than declared as literal unions. The validator has to test a loaded
  operator against the real set, and a hand-copied second list would be free to drift. The derived
  types are character-identical to what they replace.
- **It descends at most `MAX_FORMULA_AST_DEPTH` and then stops**, reporting `ok` for what it did not
  look at. That is not a hole: `exceedsMaxFormulaAstDepth` runs immediately after and refuses any
  document nesting that deep, so nothing below the bound is ever reached by anything else. An
  unbounded recursive validator would have traded a `TypeError` for a `RangeError` — the same defect
  wearing D-083's hat. **The depth VERDICT stays D-083's alone**, so the operator gets one ruling's
  message for one condition, not two.

Ordering matters and is commented at the call site: shape first, depth second, because the depth
check itself walks the AST.

The test extension covers D-108 clause 1's four shapes by name plus eleven more the same cast let
through — a bare-string ast, an array ast, an unrecognised node type, a `literal` holding `null`, an
operator §5.3 does not have (both arities), a malformed `Address` (missing `objectId`; a non-string
path segment), a half-formed `range`, an `error` node naming something other than `#REF`, and a
malformed node nested *inside* a well-formed one. Each asserts the refusal **names the slot**
(`value_1.value`) — §5.10's rule, and the difference between a usable message and "malformed
document". Two positive tests keep the guard honest: every well-formed node shape still loads, and a
document using all of them round-trips byte for byte.

### 3 — the schema owns the derived slot set (D-126)

`serializeSlot` drops a derived slot's VALUE (§5.11) but keeps its KEY, and the loader took the
file's key set as authoritative. D-018 then requires every schema-declared derived path to be
present. **So adding one derived slot to a schema invalidated every previously saved document
containing that object type** — a document saved before entry 0141 was refused with
`text_1.measuredWidth is missing`, which reads to an operator as a corrupt file rather than as a
build that moved on.

`withSchemaDerivedSlots` makes the schema the authority, in both directions:

- a declared derived path with no slot in the file gets the same `{ kind: "derived", value: null }`
  placeholder `createObjectFromCommand` writes at creation — same fill, same source of truth;
- a `derived`-kind slot whose path the schema does NOT declare is dropped (§5.1: "`derived` is fixed
  by schema"), so a stale one from an older build is not carried.

**It never overwrites a non-`derived` slot** (clause 3). A file holding a `literal` at a declared
derived path is still D-018 case 2's rejection; that check is not weakened and does not move. This
removes exactly one way to reach it — schema drift across a save — and none of the others. An object
whose type has no schema keeps its slots exactly as the file had them.

Tested with the shape D-126 asks for: an `add` object saved without `out.result` now loads, and its
`out.result` comes back **evaluated to 7**, not merely present — §5.11's "regenerated by a full
evaluation pass on load", made true of the slot set as well as the values.

### 4 — `openDocument` gets a rejection path

`.catch` on the promise chain, reporting through `onRefused` like any other refusal. `loadDocument`
no longer throws for those shapes, **but the catch stays regardless**: `file.text()` can reject on
its own, and a boundary that turns an exception into silence is the defect — not the particular
exception that exposed it.

### 5 — the corrected claims

`document.ts`'s header said "Never throws" without qualification and `deserializeDocument`'s doc
comment repeated it. Both now say so truthfully AND record the period during which it was false, with
the cause. D-108 clause 1's reasoning is why the history is kept rather than deleted: *"A false
invariant in a header is worse than a missing one — it is what stops the next reader from probing."*

## What this closes

- **D-108** — all four clauses discharged. Clause 3's prohibition on piecemeal walker hardening is
  satisfied by construction: no walker was touched.
- **D-126** — built, with the round-trip its reconciliation note asked for.
- **D-127** — built. Its clause 1 finding stands as a lesson worth keeping: a ruling deferred work to
  a trigger that had already fired twenty-four entries earlier, and it survived nine STATUS rewrites
  because it was **asserted rather than grepped**.
- **Fix-list items 15 (F5), 25 (F23), 26 (F24)** all close.

**Adding a derived slot to a schema is no longer a load-compatibility event.** D-126 clause 5 asks
every future cycle that adds one to state the load consequence in its entry; from here the honest
line is "none", which is the point.

## Verification

- `npx tsc --noEmit` and `npx tsc -p tsconfig.engine.json --noEmit` — both clean.
- `npx vitest run` — **1709 passed / 1709**, 33 files, 0 skipped, 0 `.only`. (+23 this cycle.)
- `npx vite build` — clean.
- No existing test needed changing. That is the meaningful signal here: this cycle only made
  previously-throwing and previously-refused inputs behave, so nothing that already worked moved.

## Where I got stuck

**`openDocument`'s `.catch` is untested by construction** (D-001 — it is DOM). Everything it now
guards against is tested one level down in `deserializeDocument`, which is where the throws actually
were; the `.catch` is a second line against something `file.text()` does, which no test here can
provoke.

**One thing I deliberately did not do:** validate the JOURNAL's `Operation` payloads. The file header
has always said journal structure is carried through unvalidated because nothing replays it, and that
is still true — validating it now would be inventing a contract for a reader that does not exist.
Named in the header, unchanged.

**One thing worth a reviewer's eye:** `validateFormulaAstShape` REBUILDS each node rather than
returning the input by reference. That is deliberate — the returned AST is then genuinely of the
declared type rather than a cast — but it means a loaded AST is a fresh object graph, so any future
code relying on identity between the parsed JSON and the stored AST would be surprised. Nothing does
today, and `mutate` deep-clones its payloads anyway (D-024).
