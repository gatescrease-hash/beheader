# 0092 — REVIEW (phase 3): the addressing vocabulary is invisible
Date: 2026-08-27   Phase: 3   Model: Claude Opus 5 (reviewer)
Previous entry: 0091-REVIEW-phase3   Reviewing: the human's argument that `PROJECT_BRIEF.md` has a
gap — *"How can I actually tell which object is which? Which circle is circle_1 or circle_2 to me,
the user, who only sees a canvas and the history of commands used?"*
Trigger: §6.1 item 3 — the brief is **silent** on something load-bearing.

**The human is right, and the gap is larger than the question that found it.** One ruling
(**D-092**), no code. **Q-014** is restated and is now a much narrower question.

## 1. The gap

Rule 3 makes the addressing scheme load-bearing. §5.2 gives the operator a mutable name as their half
of it. Every authoring act in §5.10 — `link`, `set`, `unlink`, `refs`, `delete`, `rename` — is
spelled in names and slot paths. **Nothing in the running application displays either one.**

Three holes, and they are separate:

| | hole | brief's answer | built? |
| --- | --- | --- | --- |
| 1 | **object → name.** Click a circle, learn it is `circle_2`. | none, anywhere | no |
| 2 | **name → object.** `select circle_2`, see which one it is. | §5.10's `select` + §5.9's highlight | **no** (D-068) |
| 3 | **object → its slots.** What can I link, and which are `derived`? | none, anywhere | no |

Hole 2 is specified and merely unbuilt. Holes 1 and 3 are not in the brief at all.

**Hole 3 is the one that blocks Phase 4 for a human**, and I had not seen it until the human's
argument sent me to look. `list` prints `circle_1 — circle`: names and types, creation order, no
slots. There is no command anywhere that prints what slots an object HAS. So
`link polygon_1.origin.x table_x.A1` requires the operator to already know that both paths exist,
and that the target is not `derived` (§5.1: a derived slot can never be `set` or `link`ed). The only
place that information exists is `primitives/schema.ts`.

The brief assumes the operator knows the schema. That is true of the brief's author and false of its
user. It is the kind of gap that is invisible from inside the project and obvious the first time
someone tries to wire two objects together, which is exactly what happened.

## 2. What I ruled, and why it needs no amendment

**D-092**, in two mechanisms:

- **A name is drawn beside each object** (clause 1). Screen-space, constant size, always on at first
  (Rule 5 — a hover or a toggle is a mechanism nobody has asked for yet). This is object rendering
  in the family of §5.9's "selection highlight, error badge, formula-driven indicator", and it is
  not §5.10's forbidden "panels, toolbars". Runs in D-068's cycle, which already owns drawing things
  that are not geometry.
- **`props <object>` prints an object's slots, their kinds, and their values** (clauses 4–6). §5.10
  says in its own words that "adding a command is one registry entry", so this is the brief's
  extension mechanism rather than an extension of the brief. Marking the KIND is the point: the
  three slot kinds are what the operator is allowed to do, and there is currently no way to learn
  which slots are `derived` and therefore refuse to be written.

I want to be explicit that clause 1 is a **reading** and not a certainty. §5.10's "minimal UI chrome
elsewhere — no panels, no toolbars" sits inside the command-line section and is, on my reading,
about not building CAD furniture: ribbons, palettes, tool buttons. A name rendered next to its
object is not furniture. If the human reads that sentence more strictly, clause 1 is theirs to
overrule and clause 4 stands alone.

Clause 2 — the label is screen-space — is worth its own note because it is the first thing in
`renderer.ts` that is unambiguously screen-space. That is **evidence toward Q-012 rather than a
taking of it**: Q-012 asks whether a stroke WIDTH and a cell SIZE are world or screen units, and
both of those are properties of the object. A name is not a property of the drawing at all.

## 3. What Q-014 is now

Narrower, and better for it. D-092 closes holes 1 and 3 without touching the brief, so the panel
question is no longer "how does the operator see anything" — it is only **"may slots be EDITED and
LINKED by mouse, in a panel?"** That is a real amendment and it stays the human's.

The human's own argument for floating-per-object is the strongest thing in the question and I have
recorded it as such: **linking is a binary operation between two slots on two different objects.**
One fixed panel shows one object at a time, so linking through it means select A, memorise the path,
select B, type it — which is the command line with extra steps. Two floating panels let the operator
click a slot on A and a slot on B. The interaction only pays for itself if more than one can be
open, which is an argument for (a) that has nothing to do with taste.

Four design questions are recorded against option (a), none blocking: it must be screen-space
anchored (a panel that zooms with its object is unreadable at both ends), occlusion needs an answer,
§5.10's "every rejection message must name the specific slots involved" has to survive into it (a
click on a derived slot that silently does nothing is worse than the command line's refusal), and it
should build `Command` values and go through `executeCommand` so **D-069** stays true.

## 4. What I did not do

- **No code.** D-092 is two implementer cycles' worth of work in two files, and both compose with
  cycles already queued.
- **No amendment to `PROJECT_BRIEF.md`.** PROCESS_BRIEF §8 forbids it and §1 makes it the human's.
  D-092 is a `DECISIONS.md` ruling, which extends the brief without editing it, and it was available
  to me only because holes 1 and 3 are things the brief is SILENT on. Where the brief SPEAKS —
  "no panels, no toolbars" — I stopped and asked.
- **Nothing against Q-014.** Not a small version, not a stub.

## 5. Where this lands in the queue

The order from 0091-REVIEW §6 absorbs D-092 without changing shape:

1. **D-068's feedback trio + D-090's prompt preview + D-092 clause 1's name labels**, in
   `renderer.ts`. All three are "draw something that is not an object", all three need the transform
   reset D-068 owns. This is now a large cycle and should be watched against §6.3's cap.
2. **D-092 clause 4's `props` command**, in `commands.ts`. Small, entirely testable, and it is what a
   properties panel would display if Q-014 is approved — so the work composes either way.
3. **D-088 + D-089**, the command input's behaviour.
4. **§5.11's load boundary** (D-081, D-083 clause 4).

**Phase 4's difficulty is now visible.** Its criterion needs `polygon_a.origin.x` bound to
`table_x.A1` and `table_x.B1` holding `= polygon_b.origin.x * 2`, authored by a human. Until D-092
lands, that human has no way to see which polygon is which or that `origin.x` is a path they may
write. The phase was reachable before and would have been miserable.

## 6. Verdict

**The brief has a gap. Ruled: D-092.** The addressing vocabulary must be visible in the running
application — a name on the canvas, and an object's slots by command. Neither needs the brief
amended, because the brief is silent on both.

**Q-014 restated and still open, for the human alone.** It is now only about editing and linking by
mouse. My recommendation is option (a), floating and per-object, after D-068 and D-092, for the
human's own reason: linking is binary and one panel cannot express a binary operation.

This is the second time in three entries that the most valuable finding came from a person using the
application rather than from anything in the repo. The first was 0091's two defects. This one is
better: it is not a bug, it is a hole in the specification that no test could have failed and no
audit of mine had noticed in ninety-one entries.
