# 0170 — REVIEW (Phase 6, third cycle): entry 0169. `engine/script/stub.ts`, `SCRIPT_SCHEMA`, `script` command ACCEPTED
Date: 2026-09-04   Phase: 6   Model: reviewer (Claude Sonnet 5)
Reviews: entry **0169** — the whole diff since 0168-REVIEW, commit `403d543`: 13 `src/` files,
893 added / 50 removed (matches the entry's own "~893 lines / 13 files" figure exactly).
Previous review: 0168-REVIEW-phase6
Verdict: **ACCEPT.** No edits. Every claim in the entry checked out against the actual diff and a
real re-run — the decision I scrutinised hardest (`out.<port>`'s dependency on its own
`placeholder.<port>`, not just §5.1's `in.*` list) is a genuine, necessary deviation from the
brief's literal type, correctly disclosed as a §6.1 trigger 3, and proven rather than asserted.
**THE GATE REOPENS** — `engine/script/`, `SCRIPT_SCHEMA`, and the `script` command may be built on
further; a Phase 6 gate entry and `image` rendering are both open next steps (STATUS.md already
names them, unchanged by this review).

## 1. What I ran, before reading anything as true

```
$ npx tsc --noEmit
(clean, exit 0)
$ npx tsc --noEmit -p tsconfig.engine.json
(clean, exit 0)
$ npm test -- --run
 Test Files  35 passed (35)
      Tests  1844 passed (1844)
$ npx vite build
✓ built in 347ms
$ grep -rnE "\.(only|skip|todo)\(" src --include=*.test.ts
(no matches)
$ grep -n "script" src/engine/graph/eval.ts
(no matches — the criterion's "no script-specific code in eval.ts" clause holds literally)
$ grep -rnE "document\.|window\.|canvas|render/" src/engine/script/stub.ts
(no matches outside the file's own header prose)
$ git diff HEAD~1 HEAD -- src/engine/graph/node.ts src/engine/mutation.ts src/engine/document.ts
(empty — the already-reviewed data model from 0167/0168-REVIEW is untouched, exactly as declared)
```

Entry 0169's numbers are exact: 1844/1844, 0 skipped, both configs clean, `vite build` clean.
**Honesty audit: the log matches the diff.** I re-ran the entry's own neutralisation claim by hand
— removed `scriptPlaceholderPath(portName)` from `scriptOutDependencies`'s `resolve` array in
`engine/script/stub.ts` and re-ran only the Phase-6-shape integration test
(`command/commands.test.ts`) — it failed with `#REF: derived slot's compute function read an
address outside its declared dependencies (D-013)` at `script_1.out.result`, exactly as claimed.
Restored (`git diff` empty), full suite green again (1844/1844).

## 2. Rule audit

- **Rule 1 (engine is pure)** — upheld. `engine/script/stub.ts` is the diff's only new engine file;
  grep for `document.`/`window.`/`canvas`/`render/` across it finds nothing outside comment prose
  naming what it must never import.
- **Rule 2 (all state change through `mutation.ts`)** — upheld. Nothing in this diff assigns
  document state; `stub.ts`'s enumerators and compute read `object`/call `read()`, never write.
- **Rule 3 (graph state plain/serializable)** — not touched. No new stored shape; `ScriptNode` (the
  call-shape `evaluateScriptOutput` takes) is a plain interface built fresh per compute call, never
  stored — see §4 below on why its fields diverge from §5.8's literal type.
- **Rule 5 (dumbest correct implementation)** — upheld. `enumerateScriptInPaths`/
  `enumerateScriptPlaceholderPaths` mirror `enumerateTableCellSlotPaths`'s shape exactly (map over a
  structural field, never throw); `makeScriptOutputCompute` checks inputs in declared order, the
  same posture `add`'s compute already takes for its own two inputs.
- **Rule 6 (slot set fixed during evaluation)** — upheld by construction and now actually exercised
  (0168-REVIEW noted no real `dynamic` derived group existed yet; this entry is the first). Every
  family here is sized by `object.ports` (mutation-only, structural), never by a slot value —
  verified: no enumerator or dependency resolver in `stub.ts` reads a `Slot.value`.
- **Rule 4, 7** — not touched by this diff.

## 3. Invariant audit

Derived-slot participation in the topological pass: `enumerateScriptOutDerivedSlots` returns an
ordinary `DerivedSlotSchema`, resolved by the same `resolveDerivedSlots` every other schema uses —
no post-pass, no special case in `eval.ts` (confirmed by grep, §1). Dependency extraction is eager
and total over the declared set (every current `in.*` plus the port's own `placeholder.<port>`) —
not lazy, not branch-aware; there is no branching here to be lazy about, but the set is computed
fresh every `deriveEdges` call (`resolve` closure, no caching). Rejection-leaves-state-unchanged:
not newly exercised by this diff (no new operation kind), inherited from 0167/0168's already-proven
behaviour. No dangling edges: this is the finding I traced hardest — see §4.

## 4. Spec conformance — the one deviation, checked in full

§5.8's own code block says `out.<port>`'s schema declares its inputs as "*all* of the node's `in.*`
slots" — one sentence, no mention of `placeholders`. Entry 0169's `scriptOutDependencies` adds the
port's own `placeholder.<port>` address to that set (decision #3), disclosed as a deviation. I
traced why this is *required*, not a convenience, rather than taking the entry's word for it:

- §5.8's `evaluateScriptOutput(node, portName, inputs)` takes the **whole `ScriptNode`** — including
  `placeholders` — as a plain parameter, unmediated by any dependency gate. In the brief's own
  (unbuilt) design, `node.placeholders[portName]` is always current because it's read directly off
  live document state, the same way `source` is passed through without being a dependency.
- This engine's actual reactive mechanism has no such direct-read path: `graph/eval.ts`'s
  `evaluateDerivedSlot` gates every `read()` call a compute makes against that slot's own declared
  dependency set (D-013) — confirmed by reading `eval.ts` directly, not just trusting the entry's
  citation. A compute that is not `ScriptNode`-shaped but a `(object, read) => Value` closure (which
  is what every other primitive's derived slot already is — `add`'s, `text`'s `resolvedContent`)
  has no way to see `placeholders` except through `read()`.
- Phase 6's criterion itself — "changing the placeholder output value moves the polygon" — is a
  claim about *reactive propagation*, which in this engine happens only via declared-dependency
  edges through the topological pass. Without `placeholder.<port>` as a declared dependency, editing
  it would never re-trigger `out.<port>` at all, and the criterion would be unmeetable in this
  engine regardless of what `evaluateScriptOutput`'s body does.

So the deviation is the correct adaptation of an abstract, not-yet-executable design (the brief's
`ScriptNode` block describes a *future* Python integration's call shape) into this engine's actual
concrete reactivity mechanism, not a shortcut. Verified by neutralisation (§1) rather than merely
plausible. Correctly flagged as §6.1 trigger 3 rather than silently taken.

The rest of §5.8 maps cleanly: `language` fixed to `"python"` (closed via `slotOptions`, matching
`TEXT_SCHEMA`'s existing mechanism for a closed set) — `source` literal, never a dependency of
anything (grep confirms `SCRIPT_SOURCE_PATH` appears nowhere in `scriptOutDependencies` or
`makeScriptOutputCompute`) — `in.<port>` an ordinary non-derived slot, kind-unrestricted exactly as
`in.<port>`'s "a normal formula slot (a binding to some upstream address)" describes the *intended
use*, not a kind restriction the brief states anywhere (no D-122-style guard is called for, and none
was invented) — `out.<port>` derived, computed by the seam. `evaluateScriptOutput`'s body is copied
verbatim from §5.8's own code block; a byte-for-byte comparison (`node.placeholders[portName] ??
null`) confirms it.

`ScriptNode.in`/`.out` as `Record<string, Value>` rather than §5.8's literal `Record<string, Slot>`
(decision #1) is the right call for the same reason as above: the seam's current body never reads
either field, so populating them with real `Slot` objects would be untested, unused code, and
worse, sourcing them from `object.slots` directly (bypassing `read()`) would read the *previous*
evaluation pass's stale cached value mid-pass. Reversible, disclosed, no stored state depends on it.

D-141 clause 7's own scope line ("data-model slice is its own slice… the stub/command lands after,
once `SCRIPT_SCHEMA` exists") is honoured — confirmed by §1's empty diff against `node.ts`/
`mutation.ts`/`document.ts`.

## 5. The placeholder/port reconciliation D-141 clause 3 asks for — traced, not taken on faith

D-141 clause 3 calls for `placeholders`/`ports.out` to be "reconciled two-way… exactly as D-018
already reconciles declared derived paths against carried slots." Entry 0169 claims no new
`validateIntegrity` check was needed. I read `mutation.ts`'s `findSchemaSlotKindMismatches` and
`deriveEdges` directly to confirm this rather than accepting the claim:

- The "no placeholder names a nonexistent port" half is true **by construction**, not by a check:
  `enumerateScriptPlaceholderPaths` is sized by `object.ports.out` itself (`stub.ts:178`), so there
  is no second authority for placeholder names that could ever diverge from the port list — the
  same one-authority argument D-141 clause 3 asks for, just satisfied structurally rather than
  validated.
- The "every out port has a placeholder" half is **not** covered by `findSchemaSlotKindMismatches`
  itself — I read its non-derived-path loop (`mutation.ts:1739-1746`) and confirmed an *absent*
  non-derived slot is explicitly tolerated there ("Absent (a separate, tolerated gap...) or
  correctly non-derived"). It is covered **indirectly**: `deriveEdges`'s "Source 2" loop
  (`mutation.ts:308-316`) builds edges from every schema-declared derived slot's dependencies
  *regardless of whether that derived slot or its dependencies actually exist as real slots* — so
  the moment `ports.out` names a port, an edge `placeholder.<name> → out.<name>` is generated
  whether or not either slot is populated, and the general dangling-reference check (not a new,
  script-specific one) rejects it if `placeholder.<name>` is missing. Combined with D-018 clause 1
  (the *derived* slot itself must exist), the two together do enforce D-141 clause 3's presence
  requirement — through the same generic mechanism `table`'s `cells.*` already relies on, exactly
  as claimed. This is a correct, if indirect, satisfaction of the ruling — worth this much detail in
  the review because "no new check was needed" is the kind of claim that's cheap to assert and
  expensive to get wrong.

## 6. Legibility audit

Headers present and accurate on both new files (`stub.ts`, `stub.test.ts`) — checked `stub.ts`'s
`WHAT THIS IS`/`INVARIANTS UPHELD HERE`/`NOT DONE HERE` against the actual code and found no false
claim (D-137 discipline held). Vocabulary locked — *port*, *placeholder*, *derived*, *formula* used
throughout, no synonym drift. No unjustified `any` in either new file. Tests are named as behaviour
sentences (`"returns one path per declared name, in declared order…"`,
`"never throws for any of the above inputs"`). `command/props.ts`'s header edit (§7 below) is
accurate against the code it describes — checked the `dynamic` branch directly; it special-cases
only `TABLE_TYPE`, confirming the disclosed gap is real.

## 7. Honesty audit — fixture changes (§6.1 trigger 5)

Read the full diffs of `mutation.test.ts`, `document.test.ts`, and `props.test.ts` against the
entry's claim that only fixtures changed, never assertions. Confirmed for all three: every changed
`it` still ends in the same `expect(...)` shape it had before (`toEqual`, `toBe(true)`, etc.); the
diffs add setup data (paired `in.*`/`placeholder.*`/`out.*` slots the new schema now requires) and
explanatory comments, nothing else. `props.test.ts`'s swap (the "no schema entry" example moving
from `script` to `polyline`) is the correct, necessary consequence of `script` gaining a schema —
not a scope-expanding edit.

## 8. Open questions

None outstanding. Q-026 stays answered at D-141; nothing here reopens it or raises a new one.

## 9. Where this leaves Phase 6

D-141 clause 7 is now fully built and reviewed, both slices. **THE GATE REOPENS**:
`engine/script/stub.ts`, `SCRIPT_SCHEMA`, and everything built on top of them may be extended
further. Two independent items remain open, both already correctly named in STATUS.md and
unchanged by this review: (1) a Phase 6 gate entry — the acceptance criterion is demonstrated
(§1's neutralisation-checked integration test) but not yet claimed as a phase gate, which is its
own `REVIEW: REQUIRED` entry per §12, not something this review pre-empts; (2) `image` rendering +
the §5.7 file picker, independently startable. `script` rendering (a labelled box with ports) and a
real `addport`/`removeport` UI mechanism remain unscoped future work — §5.10 names no grammar for
the latter, and none should be invented without a real need naming it.
