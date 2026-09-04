# 0166 — REVIEW (Phase 6, first cycle): entry 0165. `image` accepted; Q-026 ANSWERED
Date: 2026-09-03   Phase: 6   Model: reviewer (Claude Opus 5)
Reviews: entry **0165** — the whole diff since 0164-REVIEW, commit `199070b`: 12 files,
+752 / −156 (src only: 8 files).
Previous review: 0164-REVIEW-phase5-gate
Verdict: **ACCEPT WITH EDITS.** Six comment/test-name edits in `render/`, listed at §8 — no
behaviour changed, and no `src/` file entry 0165 wrote was edited at all. Two rulings issued:
**D-140** (ratifies the `source` slot deviation) and **D-141** (answers **Q-026**; the script half
of Phase 6 is UNBLOCKED).

## 1. What I ran, before reading anything as true

```
$ npm run typecheck        # tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, exit 0, both configs)
$ npx vitest run
 Test Files  34 passed (34)
      Tests  1789 passed (1789)
$ npx vite build
✓ built in 378ms
$ grep -rnE "\.(only|skip|todo)\(" src
(no matches)
$ grep -rn "PROVISIONAL(Q-026)" src
(no matches)
$ git show --stat 199070b
 12 files changed, 752 insertions(+), 156 deletions(-)
```

Entry 0165's numbers are exact: 1789/1789, 0 skipped, both configs clean, and its "~320 lines / 9
files" batch figure matches the `src/` half of the diff. **Honesty audit: the log matches the diff.**
Nothing in it is claimed as passing that isn't. The one place the entry could have flattered itself —
"I did not verify anything on screen, and cannot: nothing this cycle draws a pixel" — it doesn't.

## 2. Rule audit

- **Rule 1 (engine is pure)** — upheld. `primitives/image.ts` and `schema.ts`'s new block import
  engine paths only; grep for `document.`/`window.`/`canvas`/`render/` across the diff's engine
  files finds nothing.
- **Rule 2 (all state change through `mutation.ts`)** — upheld. `createImage` returns
  `createObjectFromCommand(...)`, the one path every creation handler already funnels through; no
  assignment to document state appears anywhere in the diff.
- **Rule 5 (dumbest correct implementation)** — upheld, and audibly so: `DEFAULT_IMAGE_WIDTH = 100`
  rather than a second `"auto"` mechanism that no engine slot could answer. Correct call, ratified
  at D-140.
- **Rule 6 (slot set fixed during evaluation)** — upheld by construction. `IMAGE_SCHEMA` is one
  `static` group; there is no sizing slot on this type, so D-046/D-097 genuinely do not reach it.
  The test asserting every group is `static` pins it.
- **Rules 3, 4, 7** — not touched by this diff.

## 3. Invariant audit

`derivedSlots: []` means the topological pass, the eager/total extraction and the
derived-inside-the-pass invariants are untouched by this type — there is nothing to evaluate.
Rejection-leaves-state-unchanged, no-dangling-edges and plain-serializable-state are exercised
rather than argued: the `link image_1.origin.x table_1.A1` test commits a real formula slot through
`mutate`, and `document.test.ts`'s round-trip now runs an `image` through D-018's two-way
reconciliation, which it could not before (an unregistered type was skipped whole — D-017's one
permitted exception). That round-trip test is the sharpest thing in the cycle and the entry
identifies why correctly.

## 4. The mutation checks — reproduced

Entry 0165 ran two neutralisations it did not owe (no acceptance criterion was claimed). I re-ran
both, one at a time, reverting between:

| Neutralised | Tests red | Anything else red | Tree restored |
|---|---|---|---|
| `image: IMAGE_SCHEMA` removed from `SCHEMAS` | 5, the named ones | no | yes |
| `ORIGIN_X_PATH` dropped from `IMAGE_SCHEMA`'s path list | 2, the named ones | no | yes |

Both reproduce exactly as logged, including the sharp half: with `ORIGIN_X_PATH` undeclared,
creation still SUCCEEDS (an undeclared literal slot is legal state, D-049) and it is the `link` that
fails — precisely what D-017 says a schema entry buys. An implementer running D-016's discipline on
a cycle that did not owe it is worth naming.

## 5. Spec conformance, and the deviation

§5.7's five-name slot list versus the `source` slot the data URL needs is the cycle's one real
question, and entry 0165 handled it the way §6.1 trigger 3 asks: build it, disclose it three times,
stop for review. **Ruled at D-140: `source` is legitimate and permanent, it is NOT narrowed to
`literal` (D-122's reason does not reach a string nothing parses), `opacity` stays unbounded, and a
freshly created image being invisible and unselectable is correct as shipped** — D-066 makes drawn
extent and clickable extent one extent, so an extent without a drawing would break a ruling to
manufacture a click target for something nobody can see. The decision not to add `w=`/`h=` to
§5.10's form is also correct: §8's last bullet forbids exactly that gold-plating, and the stray-`w=`
parse-failure test pins it.

## 6. The finding — three `render/` files describe `image` as having no schema, and it now has one

Entry 0165 correctly repaired the two comments in `commands.ts` its own work made false (D-065), and
missed that the same work falsified statements in files it did not open:

- `render/renderer.ts`'s header: "`script`/`image` objects (**no schema — Phase 6**)".
- `render/hittest.ts`'s header: "`script`/`image` bounding boxes … **no schema or visual definition
  exists to read yet**".
- The inline `return` arms in `renderer.ts` and `hittest.ts`, plus two test names, all saying "no
  schema/visual definition yet" — a phrase that was *already* loose before this cycle, since `value`
  and `add` sit in those same arms and have had schemas since Phase 0.

This is a D-060 problem, not bookkeeping: a reader who greps "image" in `render/` is now told
something false about the current code, and the true reason those arms draw nothing is D-066 plus
the absence of a *visual* definition, which is a different and more useful fact. **Not a REVISE** —
the sentences are one word wrong each and no behaviour is at stake, so I made the edits (§8) rather
than spending a cycle on them. The lesson needs no new ruling: **D-137's principle already covers
it** — a statement is part of the diff that falsifies it, wherever that statement lives.

## 7. Q-026 — ANSWERED, not deferred

Q-026 is the best-posed question in this log's recent history: it names both halves of the gap (no
home for port NAMES; `derivedSlots` fixed per TYPE while `out.*` is per OBJECT), enumerates four
options with real costs, and takes no provisional choice — correctly, because every option changes
`GraphObject`, the mutation sequence, or the schema registry, which §7 clause 3 puts beyond a tagged
guess. Stopping cost one cycle; guessing would have cost the phase.

**Ruled at D-141: option (a).** Port names are structural, ordered, name-only state on
`GraphObject`; §5.8's own `ScriptNode` block already models structural fields beside slots, so this
is the brief's shape rather than an invention. `ports.out` is the single authority for the out-port
name set and `placeholders` holds VALUES only, reconciled two-way in D-018's existing shape.
`ObjectSchema.derivedSlots` widens to `static`/`dynamic` groups, resolved against the OBJECT and
never against `Object.keys(object.slots)` (D-010 binds the new resolver as it binds the old).
(b), (c) and (d) are rejected on the record. **D-141 clause 7 scopes the unblocked work: the
data-model change is its own slice, and `engine/script/stub.ts` — a §6.1 trigger 2 review point in
its own right — must NOT be fused into it.**

## 8. Edits made by this review

Five files, all ones entry 0165 did not touch; nothing it wrote was edited.

1. `src/render/renderer.ts` header — the `script`/`image` bullet now says no VISUAL definition, and
   names `image`'s schema (entry 0165) as present and still undrawn.
2. `src/render/renderer.ts` — `drawObject`'s inline arm: "No visual definition yet". (The
   selection-highlight arm below it already said "Nothing drawn for these yet"; left alone.)
3. `src/render/hittest.ts` header — same correction, plus the real reason (D-066: an object that
   draws nothing has nothing to hit).
4. `src/render/hittest.ts` — inline arm: "No visual definition yet".
5. `src/render/renderer.test.ts` and `src/render/hittest.test.ts` — the two names carrying the same
   false phrase. Names only; no assertion touched.

`src/render/extent.ts` needed no edit — its arm already says "Draws nothing yet".

Re-verified after the edits: typecheck clean both configs, **1789/1789 passing, 0 skipped**,
`vite build` clean.

## 9. Where this leaves Phase 6

`image` is built, headless, and accepted. Its remaining half — a renderer arm, an extent, the
decoded-bitmap cache and §5.7's file picker — is a real cycle, and is now the only thing between an
`image` object and a visible one; nobody should call §5.7 done until then, and STATUS says so. The
script half is unblocked by D-141 and starts with the data-model slice, not the stub. Phase 6's
acceptance criterion remains **NOT YET**, claimed by nobody.
