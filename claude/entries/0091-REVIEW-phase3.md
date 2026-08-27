# 0091 — REVIEW (phase 3): the manual check, run by the human
Date: 2026-08-26   Phase: 3   Model: Claude Opus 5 (reviewer), recording the human's session
Previous entry: 0090-REVIEW-phase3   Reviewing: **the running application**, in Vite, on a real
monitor with a real mouse and keyboard.
Trigger: **D-084 clause 2** — the check that entry 0090-REVIEW held the Phase 3 criterion open for.

**D-084 clause 2 is DISCHARGED.** The human ran the application and reported seven notes. This entry
records them verbatim in substance, rules on each, and says what is now owed.

**Phase 3's acceptance criterion — *"you can create a polygon and a table by command, see both
drawn, pan/zoom, select, and drag the polygon"* — PASSES.** Every verb in it was exercised by a
person. Nothing in the seven notes contradicts the criterion. What the notes describe is a
criterion that passes over an application that is not yet pleasant to use, which is exactly the
distinction a phase gate is for.

**Phase 4 is OPEN.**

Verdict on the notes: **five actionable, two already owed.** Two fixed here. Three ruled and queued
(**D-088**, **D-089**, **D-090**). One answered (**D-091**). One escalated to the human as **Q-014**,
because it contradicts the brief and no model may settle it.

## 1. What the human reported, and what each note turned out to be

**Note 1 — zoom and pan with the mouse work well.** No action. Recorded because it is the first
independent confirmation that `render/camera.ts` behaves, and because D-061's top-left convention
and D-062's range correction are load paths nobody had exercised by hand.

**Note 2 — the command line must be clicked before it accepts keystrokes.** A defect, reproduced by
reading. `start` called `input.focus()` at startup and again inside the canvas `pointerdown`
listener, which looks sufficient and is not: moving focus to the body is the browser's DEFAULT
action for a press, and a default action runs *after* the listener that could have refused it. So
every canvas click blew the focus away a moment after the code restored it. **Fixed here** (clause 1
of **D-088**).

The human asked for more than the fix: AutoCAD's behaviour, where typing `circle` after panning and
dragging just works, with no click and no thought. That is **§5.10's existing sentence** — "always
focused when the user is not editing text or a cell" — implemented properly. **D-088** rules the
whole behaviour, including the part that is easy to get wrong: a keystroke with `ctrl`/`alt`/`meta`
held is not printable and must never route, or `ctrl+r` stops reloading and `ctrl+c` types a `c`.

**Note 3 — up and down arrows should recall previous commands.** Not in the brief, and it does not
need to be. §1 names AutoCAD as the interaction model, §8's deferred "command-language gold-plating"
is about the command *language* rather than the input's ergonomics, and §1 of PROCESS_BRIEF makes
the human final arbiter on product questions. Ruled in as **D-089**, whose one substantive clause is
that the history lives in `AppState` and not in two mutable variables inside `start` — the same
split that made 0090-REVIEW's four findings survivable.

**Note 4 — a multi-point command shows no reference point.** Pick a circle's centre and there is
nothing on screen saying where it landed, so choosing the radius is a guess. Real, uncovered by
anything ruled so far, and the most interesting note of the seven: D-072 tested that a picked world
point reaches the right prompt step, which is the whole of what a headless test can assert, and the
thing it cannot assert is that a person can see the point. Ruled as **D-090**, to run in D-068's
cycle because both need the same new capability (drawing something that is not an object) and the
same transform reset. Clause 2 is the one to defend: a preview is drawn from `state.pending` and
never enters the document, so no half-built object reaches `mutate`, the journal, or `evaluate`.

**Note 5 — shapes are near-black, the table's grid is grey. Intentional?** Half-intentional, which
is not a good enough answer, so **D-091** makes it a real one. Yes, deliberate, and it stands: a
grid is chrome around content, an outline is the object. But `DEFAULT_SHAPE_STROKE_STYLE` carries a
paragraph of reasoning in [renderer.ts](src/render/renderer.ts) and `TABLE_GRID_STROKE_STYLE` was
typed with no comment at all, so until now nothing in the repo could have told the human which it
was. Both are absorbed by the `style`-slots cycle (Q-012).

**Note 6 — everything on the canvas is fuzzy; the command line is not.** A defect, and the
diagnosis is certain rather than probable: the canvas backing store was sized in CSS pixels, so on
any display with a device pixel ratio above 1 (Windows 11 at 125% or 150% scaling is the common
case) the browser resampled every line drawn into it. The log and the input are DOM text and are
rendered by the browser at full resolution, which is precisely why only the picture looked soft.
**Fixed here.** 0090-REVIEW's **D-086** clause 3 anticipated this exact change and required the
CSS-to-backing conversion to land in the same commit as the resize, which it did.

**Note 7 — a properties panel on the left, for the selected object's slots.** Two halves, and they
part company.

- *"When an object is actively selected, it should look slightly different"* — already owed, already
  next. That is **D-068**'s selection highlight.
- *The panel itself* — **contradicts §5.10 in terms**: "Minimal UI chrome elsewhere — no panels, no
  toolbars." PROCESS_BRIEF §8 forbids the reviewer from amending the design mid-review, and §1 makes
  this the human's call, so it is raised as **Q-014** and nothing is built against it. The
  recommendation there is option (a): amend §5.10 to allow one properties panel that writes through
  the same `mutate` path `commands.ts` uses, after D-068 lands.

The reason Q-014 is a question and not a ruling deserves a sentence, because the human's phrasing —
*"that's where the user will really spend most of their time linking variables and functions, not
through the command line"* — is a change of direction, not a feature request. Every ruling from
D-069 (`executeCommand` is the only place a `Command` meets a `Document`) through D-072's prompt
sequences and D-075's effects-as-data assumed the command line was the authoring model. A panel
that edits slots is a second authoring path. Rule 2 permits it cleanly, and it happens to moot
**Q-013** (how a general formula gets authored at all, which §5.10 has no command for and Phase 4(b)
requires). It is a good idea. It is still the owner's to make on purpose.

## 2. Edits made

Both in [main.ts](src/main.ts)'s DOM half, both small, both verifiable by the human in the running
Vite session rather than by any test in this repo.

1. **Focus survives a canvas press** (D-088 clause 1). `event.preventDefault()` in the canvas
   `pointerdown` listener, with `input.focus()` kept for the case where something else already took
   the keyboard. Both lines are commented with why the obvious version failed.
2. **The canvas backing store is sized in device pixels** (note 6, D-086). `paint` multiplies the
   CSS size by `devicePixelRatio`; `screenPointOf` converts a pointer event's CSS pixels into
   backing pixels by the ratio it reads off the canvas itself, so it stays exact through `paint`'s
   rounding and degrades to 1 for a canvas the layout has given no width.
3. **Pan deltas moved into backing pixels** with everything else. Not cosmetic: `panByScreen` was
   being handed `clientX` deltas in CSS pixels while the camera's screen space is backing pixels, so
   on a 150%-scaled display the canvas panned at two thirds of the pointer's speed. Nobody reported
   it, and I would not have found it without note 6 forcing the conversion.

`tsc` clean on both configs. 1126/1126, 0 skipped. `npm run build` succeeds.

**None of the three is covered by a test**, and that is now a stated property of this region rather
than a confession: D-084's mechanism is what found the first two, and it is the mechanism that will
have to confirm them.

## 3. What I did NOT do

- **No fix for note 2's full behaviour.** Clause 1 stops the focus being lost. Clauses 2 to 4 of
  D-088 — routing a printable keystroke from anywhere, excluding modifier combinations — are an
  implementer cycle with tests, not a reviewer's edit.
- **Nothing for notes 3, 4 or 7.** Ruled and queued, or escalated.
- **No brief amendment.** Q-014 is a question for the human.
- **No colour change.** D-091 answers the question that was asked and changes nothing.

## 4. Rule and honesty audit on this session's edits

Rules 1 through 7: untouched. The edits are three expressions and two comments inside `start`,
which is below every seam the rules govern. `engine/` unchanged, `mutate` unchanged, no state
written outside the mutation API, nothing serialized, no dependency added.

One honesty note, against myself. 0090-REVIEW's F1 fixed the canvas sizing and wrote **D-086**
clause 2 — "one backing pixel is one CSS pixel" — as an invariant. That was the *correct* fix for
the bug in front of me and the *wrong* long-run constant: the right invariant is that the backing
store matches the display, and the conversion belongs at `screenPointOf`. D-086 clause 3 is the
reason this cost six lines instead of a rewrite, because it named in advance where the conversion
would have to go. The clause is now satisfied and the invariant in clause 2 is superseded by the
ratio conversion. Recorded here rather than by editing D-086, which is append-only.

## 5. Fix list

Unchanged from 0090-REVIEW §9 except as noted. Items 1 through 5 stand.

New, none blocking:

6. **The pan gesture does not restore focus by itself.** It does now via D-088 clause 1's
   `preventDefault`, but a middle-drag started outside the canvas is untested and unthought-about.
   Owned by D-088's cycle.
7. **`TABLE_GRID_STROKE_STYLE` has no comment** where its neighbour has a paragraph. D-091 explains
   the choice; the constant should carry a line of it. Owned by the `style`-slots cycle (Q-012).

## 6. Where the project stands

**Phase 3: PASSED.** Criterion demonstrated by executable test at entry 0089, confirmed by a human
at entry 0091. **Phase 4 is open** and nothing procedural stands in front of it.

The recommended order is unchanged in shape and now has more in it. Next cycle: **D-068's feedback
trio plus D-090's prompt preview**, together, in `renderer.ts` — they are the same capability and
the same transform reset, and between them they answer the "I can't see what's selected" and "I
can't see where I clicked" halves of the human's session. Then **D-088 plus D-089**, the input's
behaviour, which is the other thing the human actually felt. Then §5.11's load boundary (D-081,
D-083 clause 4), which is owed and quiet.

**Phase 4 itself should wait for those three cycles**, and this is a recommendation rather than a
ruling: Phase 4's criterion is *"all three hold simultaneously in one document, with no false
cycle"*, and (c) is "dragging `polygon_a` slides it in Y only, **with feedback that X is driven**".
That feedback is D-068's third piece. Phase 4 is reachable today with the log carrying the feedback,
and it will demonstrate far more if the canvas does.

## 7. Verdict

**The manual check is recorded. D-084 clause 2 is discharged. Phase 3's gate is CLOSED and PASSED.**

Seven notes, and the two that were defects were both invisible to 1,126 passing tests, both in
`main.ts`'s DOM half, and both found in the first two minutes a person spent with the application.
That is now the second consecutive review where every finding came from that region. The lesson is
not that the tests are weak — they caught nothing wrong because there was nothing wrong in what they
cover. The lesson is that this project's remaining risk is concentrated in a region that only a
human can inspect, and that a five-minute session is the highest-yield review instrument available
to it. **D-084's mechanism should be repeated at every phase gate from here.**
