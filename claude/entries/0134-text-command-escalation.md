# 0134 — The `text` command: escalated on position (Q-022) and F13 (Q-023); no code
Date: 2026-09-01   Phase: 5   Model: Sonnet 5 (implementer)
Previous entry: 0133-REVIEW-phase5   Last review: 0133-REVIEW-phase5 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; 0 source lines changed (questions + logs only).

## Declared scope

Build the `text` command (§5.10): `command/parser.ts` grammar + `commands.ts` handler, moving
`text` out of `COMMANDS_SPECIFIED_BUT_NOT_BUILT`, creating a `text` object with all non-derived
slots + both derived placeholders and sane `style` defaults.

## Explicitly not in scope

`render/renderer.ts`'s text-drawing pass, markdown-lite rendering, layout. D-109 clauses 1–2 and
Q-017 headers (the render-only alternative). Any change to `primitives/text.ts` or the block-tree
engine.

## What actually happened — the slice is blocked before any code

Orienting into the slice, two §6.1-trigger-3 items fire, and the first is not reversible, so per
PROCESS_BRIEF §7.3 the cycle stops and escalates rather than guessing. Both were named in advance by
0130-REVIEW §7 and 0133-REVIEW §7 as the reason "that cycle likely escalates rather than
completing." Nothing in `src/` changed.

### 1. A `text` object has no position (→ Q-022, raised)

§5.6's `TextBox` lists its slots — `content`, `width`, `height`, `overflow`, `style.*` — and none is
a position. But §5.10's command form is `text x=0 y=0 "…"`, §5.9's drag rule assumes every object
either has an `origin` slot or per-vertex slots, and Phase 7 needs two text boxes "positioned
relative to their intersection's center" — which requires the position to be a *slot* so it can be
`link`ed. The brief is internally inconsistent, not merely silent.

The `text` command cannot create the object without deciding this: `createObjectFromCommand`
(`commands.ts`) supplies one literal value per schema-declared non-derived path, so `x=`/`y=` have
nowhere to land until `TEXT_SCHEMA` declares where. Adding `origin.x`/`origin.y` to the schema
(recommendation (a) in Q-022) is almost certainly right — it mirrors `circle`/`rect`/`polygon`
exactly and reuses `ORIGIN_X_PATH`/`ORIGIN_Y_PATH` — but it is **slot-set membership on a
load-bearing file** (`primitives/schema.ts`, §6.2) and a **named deviation from a brief section's
explicit list**. §7.3: "anything shaping the data model … stop the cycle and escalate." D-046's
whole rationale is that guessing wrong about which slots a schema declares is the expensive kind of
wrong. So it is a question, not a provisional guess — even though it is reversible in practice (no
`text` command means no saved document can contain a `text` object, so no stored state depends on
the answer). The reviewer can likely rule (a) in one line; if not, it is the human's.

### 2. F13 — a `formula`-driven `content` slot's inner references are untracked (→ Q-023, raised)

Owed a ruling by this cycle per 0130-REVIEW / 0133-REVIEW and `primitives/text.ts`'s own NOT DONE
HERE. `content` is read `literal`-only at edge-derivation time (Rule 6 timing — a formula's value is
not written until step 7), so a `link`ed/`set =`'d `content` commits with its embedded `{= }`/`{? }`
references untracked. `resolveTextDependencyAddresses` already documents this as the F13 gap.

Recommendation (Q-023 option (a)): refuse a `formula`/`derived` `content` slot outright, à la D-046
— a removable guard in `resolveWritableSlot`. This one **is** a takeable reversible provisional
(it shapes no data model, no stored state depends on it), but the cycle that would take it is the
`text` command cycle, which is blocked on Q-022 — and a `PROVISIONAL(Q-023)` guard with no
reachable site is debt without a reader (the Q-016/Q-019 reasoning). So it waits with Q-022.

## Decisions I made

None that touch code. The one judgement call: escalate rather than take (a) for Q-022 provisionally.
Weighed the asymmetry — a wrong escalation costs one cycle and a one-line ruling; a wrong guess on
schema slot membership is D-046's "mutate commits a document its own validateIntegrity rejects"
class of bug plus rework of a load-bearing schema and its tests. §7's own line: "Asking a good
question costs one cycle. Guessing wrong on addressing costs the project."

## Verification (real output)

```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, no output — both configs)

$ npx vitest run
 Test Files  30 passed (30)
      Tests  1427 passed (1427)
```

0 skipped, 0 `.only`. No source file changed, so these match 0133-REVIEW exactly — pasted to honour
§3 step 5, not because anything moved.

## Acceptance criteria status

Phase 5 criterion ("a text box reading `Radius: {= table_x.A1 }{? … }` updates … wraps at its set
width … re-renders when a value referenced only inside the currently non-taken branch changes") —
**NOT YET, and now blocked on Q-022.** A text box cannot be placed on the canvas, drawn, or
selected without a position, and the position question is the human's/reviewer's to settle.

## Where I got stuck / what is unfinished

The whole declared slice. The `text` command is unbuildable until Q-022 is ruled (Q-023 then falls
out with it). Everything else about the command is routine — a registry entry modelled on `table`'s
(a positional quoted-string `content` argument plus `x=`/`y=`, and `style` defaults chosen by the
handler), the `COMMANDS_SPECIFIED_BUT_NOT_BUILT` move pinned by the existing disjoint-lists test,
and `createObjectFromCommand` already fills both derived placeholders mechanically. None of it is
worth writing against a schema shape that may change.

## Open questions raised

- **Q-022** — where a `text` object's position lives (§5.6 has no `origin` slot; §5.10 and Phase 7
  need one). Recommendation (a): add `origin.x`/`origin.y` literal slots to `TEXT_SCHEMA`. Not
  reversible in §7's sense (slot-set membership, load-bearing schema, §5.6 deviation) → escalated,
  nothing built, nothing tagged.
- **Q-023** — F13: is a `formula`/`derived` `content` slot tracked or refused (à la D-046)?
  Recommendation (a): refuse it. Reversible; provisional to be taken by the `text` command cycle
  once Q-022 unblocks it. Nothing built, nothing tagged.

## Review point

Fired: **§6.1 trigger 3** — the brief is self-contradictory on something load-bearing (§5.6 vs.
§5.10/§5.9/Phase 7 on a `text` object's position), and one of the two ambiguities is not reversible.
Per §7.3 the cycle stops here.

Batch: cycle 1/3, diff 0 source lines / 0 source files (cap 800/10). Only `OPEN_QUESTIONS.md`,
this entry, and `STATUS.md` changed.

REVIEW: REQUIRED
Reason: §6.1 trigger 3 — a non-reversible brief inconsistency (Q-022) blocking the next slice;
needs a ruling before the `text` command can proceed.
Questions for reviewer:
  1. Q-022 — is recommendation (a) (add `origin.x`/`origin.y` literal slots to `TEXT_SCHEMA`, same
     spelling as the geometry presets) yours to rule, or the human's? Was stopping right, or should
     (a) have been taken provisionally given no `text` object is reachable today?
  2. Q-023 — confirm (a) (refuse a `formula`/`derived` `content` slot, à la D-046) is the intended
     direction and may be taken provisionally by the `text` command cycle once Q-022 is settled.
  3. While Q-022 is pending, is the render-only slice (D-109 clauses 1–2 — cell decimal precision +
     no cell-text clipping — plus Q-017 headers) the right thing to pick up next? 0133-REVIEW §7
     names it as "the smallest un-owed item needing no ruling."
