# 0168 — REVIEW (Phase 6, second cycle): entry 0167. D-141's data model ACCEPTED WITH EDITS
Date: 2026-09-03   Phase: 6   Model: reviewer (Claude Sonnet 5)
Reviews: entry **0167** — the whole diff since 0166-REVIEW, commit `53d9c77`: 14 `src/` files,
711 added / 76 removed (matches the entry's own "~635 lines / 14 files" figure exactly:
711 + 76 = 787 changed lines, entry rounds down).
Previous review: 0166-REVIEW-phase6
Verdict: **ACCEPT WITH EDITS.** One real gap found and fixed — `isLegalPortName` was looser than
the grammar it exists to protect. Three files edited (`graph/node.ts`, `mutation.ts`,
`document.ts`), all narrow, all re-verified green. No new ruling needed; D-141 stands exactly as
written, unamended. **THE GATE REOPENS** — `engine/script/stub.ts` may start.

## 1. What I ran, before reading anything as true

```
$ npm run typecheck        # tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, exit 0, both configs)
$ npm test
 Test Files  34 passed (34)
      Tests  1815 passed (1815)
$ npx vite build
✓ built in 379ms
$ grep -rnE "\.(only|skip|todo)\(" src --include=*.test.ts
(no matches)
$ grep -rn "PROVISIONAL(Q-026)" src
(no matches)
```

Entry 0167's numbers are exact: 1815/1815, 0 skipped, both configs clean, 26 new tests (5 + 4 + 10
+ 7, matching the entry's own breakdown). **Honesty audit: the log matches the diff.** The two
neutralisation claims in the entry's Verification table were re-run by hand (removing
`findInvalidPortOperations`'s call from `mutate`; un-excluding the removed port's own key from
`removePort`'s slot-drop filter) — both reproduce exactly as logged, tree restored identically each
time (`git diff` empty after re-applying). The second is the load-bearing one and it holds: the
existing dangling-reference check genuinely is what rejects removing a referenced out port, not a
mechanism the entry merely asserts.

## 2. Rule audit

- **Rule 1 (engine is pure)** — upheld. Every touched file is under `src/engine/` or a caller in
  `src/command/`; grep for `document.`/`window.`/`canvas`/`render/` across the diff finds nothing.
- **Rule 2 (all state change through `mutation.ts`)** — upheld. `addPort`/`removePort` are folded
  inside `applyOperation`, gated by `findInvalidPortOperations` before staging, exactly like every
  other operation kind. No assignment to document state appears outside `mutation.ts`.
- **Rule 3 (graph state plain/serializable)** — upheld. `GraphObjectPorts` is two `readonly
  string[]`s; no closures, no class instances, no live `Map`s. `findInvalidPortOperations`'s
  `tracked` map is working state local to one function call, not stored document state — the same
  posture `findInvalidNames`'s own tracking set already has.
- **Rule 5 (dumbest correct implementation)** — upheld. `findInvalidPortOperations` mirrors
  `findInvalidNames`'s left-to-right simulation rather than inventing a second strategy;
  `removePort` reuses the existing dangling-reference check rather than adding a parallel one.
- **Rule 6 (slot set fixed during evaluation)** — upheld by construction; not yet exercised by a
  real `dynamic` group (every schema in today's registry still declares only `static`). The shape
  is sound and `resolveDerivedSlots`'s single-resolver discipline is what will keep the eventual
  `script.out.*` `dynamic` group from drifting the way D-017 already prevents for
  `NonDerivedSlotPathGroup`.
- **Rule 4, 7** — not touched by this diff.

## 3. Invariant audit

`derivedSlots` widening is a pure reshape: every existing schema wraps its old flat array in one
`{ kind: "static", slots: [...] }` group, and `resolveDerivedSlots` concatenates `static` groups in
order — verified by the full pre-existing suite passing unmodified in assertion (only re-plumbed
through the new signature) both before and after the widening. Dependency extraction, evaluation
order, and derived-inside-the-topological-pass are all untouched: nothing here changes what a
`static` group resolves to, only how many places ask for it correctly. No dangling edges: `removePort`
either drops a slot nothing else can reference (`in.*`, per §5.8's own model — see §6 below) or one
whose removal is rejected outright if something still does (`out.*`). Rejection-leaves-state-unchanged
is exercised directly: the "leaves the caller's objects untouched on a rejection" test round-trips a
real `JSON.stringify` snapshot.

## 4. Spec conformance

D-141's seven clauses map onto the diff cleanly:

- Clause 1 (structural, not a slot value/key) — `GraphObject.ports?: GraphObjectPorts`, plain data.
- Clause 2 (ordered, name-only, illegal names rejected) — done, with the one gap in §5 below.
- Clause 3 (`placeholders` is VALUES only; `ports.out` is the name authority) — correctly deferred;
  nothing in this cycle touches `placeholders`, which has nowhere to live before `SCRIPT_SCHEMA`.
- Clause 4 (`derivedSlots` widened to the SAME group shape as `nonDerivedSlotPaths`) — done, and
  `findDerivedSlotSchema`/`resolveDerivedSlots` correctly take the whole object now, not a bare type.
- Clause 5 (rejected alternatives) — not re-litigated; correctly absent from this cycle.
- Clause 6 (mutation-only port changes; reject-not-drop on a referenced out port) — done, and
  proven by neutralisation rather than merely asserted (§1 above).
- Clause 7 (scope: data model only, `script` schema/stub/command excluded) — honoured exactly;
  `grep -rn "SCRIPT_SCHEMA\|script/stub" src` finds nothing this cycle added.

## 5. The finding — `isLegalPortName` was looser than the grammar its own comment says it enforces

`graph/node.ts`'s original `isLegalPortName` was `name.length > 0 && !name.includes(".")`. Its own
doc comment gave the reason for existing: a dot would forge a slot key whose path segment
`address.ts`'s `PATH_SEGMENT_PATTERN` (`/^[a-zA-Z0-9_]+$/`, checked in `parseAddress`) rejects,
"giving the port an address nothing could ever address correctly." But `PATH_SEGMENT_PATTERN`
rejects far more than a bare dot — spaces, hyphens, and anything outside `[a-zA-Z0-9_]` all fail it
too. The check as written let `addPort` accept a name like `"my-port"` or `"my port"`: legal to
create (passes `isLegalPortName`, passes `findInvalidPortOperations`, round-trips through
`document.ts`'s loader), yet `script_1.out.my-port` is a string `parseAddress` rejects outright —
exactly the unaddressable-port outcome the function's own comment says it exists to prevent. I
confirmed this with a small script comparing both patterns before touching anything (`isLegalPortName`
true, `PATH_SEGMENT_PATTERN` false, for `"my-port"`, `"my port"`, and a non-ASCII name).

Not reachable today — no `SCRIPT_SCHEMA` exists yet, so nothing can create a `script` object through
the command layer, and the mutation/document tests that exercise `addPort`/`ports` all build
`GraphObject`s by hand with ordinary names. It would have become live and silently wrong the moment
`engine/script/stub.ts` landed, which is exactly why D-141 clause 7 makes this its own reviewed
batch before that slice starts.

`node.ts` cannot import `address.ts` to share `PATH_SEGMENT_PATTERN` directly — `address.ts` already
imports `node.ts` for `ObjectType`/`TABLE_TYPE`, so the reverse import would cycle. This is a genuine
constraint, not an oversight to wave away with "just import it"; the fix is a hand-maintained
duplicate of the same regex, the same posture D-119 already accepts for
`resolveTextDependencyAddresses`/`deriveEdges`'s Source 1 (STATUS.md item 10): change one, change
both, same cycle, and name the pair at both sites.

**Not a REVISE** — one file's predicate plus its call sites' doc comments and two user-facing
messages, no behaviour outside that predicate changes, no ruling is needed (the grammar this should
have matched was never in question — D-141 clause 2 already says "a dot would forge a slot key,"
and the fuller reason was already written in the very comment that had the gap). I made the edit
rather than sending it back for a second cycle.

## 6. A documentation note, not a defect — `in.*` readability is a modeled convention, not an enforced one

`RemovePortOperation`'s doc comment says removing an IN port needs no dangling-reference check
because "nothing outside a script node's own formulas can read its `in.*`." That is §5.8's intended
usage (`in.<port>` is written into by a binding; nothing is documented as reading it back out), but
nothing in today's engine actually prevents an ordinary formula elsewhere from naming
`script_1.in.factor` as a read address once such a slot exists — the engine has no per-family
read/write restriction. This is unreachable for the identical reason §5 is: no `SCRIPT_SCHEMA`
exists yet, so no `in.*` slot can exist for anything to reference. Flagging it now, not as a fix,
so whoever writes `SCRIPT_SCHEMA` checks whether that assumption still holds before relying on it —
if it doesn't, `removePort` on an `in` port will need the SAME dangling-reference reasoning `out`
already gets, not the "no analogous rejection path is needed" this cycle wrote.

## 7. Edits made by this review

Three files, all narrow, all re-verified green (typecheck clean both configs, 1818/1818 passing —
1815 plus 3 regression tests this review added, 0 skipped, `vite build` clean):

1. `src/engine/graph/node.ts` — `isLegalPortName` now matches `address.ts`'s
   `PATH_SEGMENT_PATTERN` exactly (`/^[a-zA-Z0-9_]+$/`) instead of "non-empty, no dot"; doc comment
   rewritten to name the gap, the fix, and the D-119-style hand-maintained-pair posture. Added two
   tests: `isLegalPortName` rejecting `"my-port"`/`"my port"`/`"café"`.
2. `src/engine/mutation.ts` — `AddPortOperation`'s doc comment and `findInvalidPortOperations`'s
   rejection message updated to stop saying "non-empty, no dot" where the real grammar is now
   stricter. Added one test: `addPort` rejecting `"my-port"`/`"my port"` through `mutate`.
3. `src/engine/document.ts` — `reconstructPorts`'s doc comment and its rejection message updated
   the same way. Added one test: `deserializeDocument` rejecting a loaded `ports.in` entry of
   `"my-port"`/`"my port"`.
4. `src/engine/primitives/schema.ts` — `DerivedSlotGroup`'s doc comment claimed its `dynamic` case
   "MUST be resolved only during edge derivation," copied from `NonDerivedSlotPathGroup`'s comment
   where it is true (three named callers). For `DerivedSlotGroup` it is not — `resolveDerivedSlots`
   three paragraphs later correctly lists eight call sites including `eval.ts`, `commands.ts`,
   `props.ts`, and `document.ts`. Reworded to the actual invariant (resolved fresh at every call,
   never cached) instead of a false claim about which functions may call it. No behaviour change;
   D-137's "a statement is part of the diff that falsifies it" reach extends to a body comment that
   was already false the moment the paragraph after it was written, not just to file headers.

## 8. Open questions

None outstanding. Q-026 stays answered at D-141; nothing here reopens it or raises a new one.

## 9. Where this leaves Phase 6

D-141 clause 7's data-model slice is accepted. **THE GATE REOPENS**: `graph/node.ts`, `mutation.ts`,
`document.ts`, and `primitives/schema.ts` may be built on again, and `engine/script/stub.ts` +
`SCRIPT_SCHEMA` + §5.10's `script` command — D-141 clause 7's own next slice — may start. Its first
file is its own §6.1 trigger 2 review point; do not fuse it with anything else. §6's note in this
entry (in-port readability) is not a blocker — it is a thing for that cycle's author to check, not
re-derive from scratch. `image` rendering + the §5.7 file picker remains independently startable,
as STATUS.md already says. Phase 6's acceptance criterion remains **NOT YET**, claimed by nobody.
