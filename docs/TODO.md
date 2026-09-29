# TODO - Beheader

The open work, and nothing else. `STATUS.md` describes the code that exists,
and this file names the changes nobody has made yet.

Take an item, build it with its tests, run the four checks in `CLAUDE.md`, and
delete the item when it lands. Do not rewrite it into a record of the work.
Git holds what was done, and this file holds what is left.

[RUST_PORT.md](RUST_PORT.md) holds the Rust engine migration plan, its stable
work register, and the measurements behind leaving that migration unscheduled.
Port packages are tracked there. They become active only if the spec reopens
that choice.

A new item names the change, gives the reason, and says how a reader will know
it is finished. Anything else is a note, and a note belongs in the header of
the file it is about.

---

## Open

- Implement direct text and table editing, adaptive grid, persistent quick
  properties, and addressable layers as specified in Direct editing and layers.
  Verify inheritance, overrides, visibility, ordering, save/load, resizing and
  formatting in tests and in the browser.

The remaining item below carries out Rule 5 of `SPEC.md`, which the engine does
not meet. Evaluation and staging no longer copy or recompute what a batch
leaves alone. A refused batch still costs the whole document, because the three checks below read every
object before they can refuse anything. Over value chains of 1000, 4000 and
16000 objects, a batch refused at the integrity check took about 1.8, 6.3 and
33 milliseconds.

- Derive edges, check integrity and search for cycles over the part of the graph
  a batch changes, rather than over the whole document. A new cycle has to pass
  through an edge the batch added, and a new dangling reference has to start or
  end at a slot the batch touched, so each check has a bounded region to read.
  The edges of the committed state have to be kept somewhere a later batch can
  reach, which the plain object list does not offer. A cache keyed by the shared
  object records is one candidate. The list itself sets a floor under all of
  this: every operation in `applyOperation` and the evaluation pass map over the
  whole array to build the next one, so a batch costs at least one pass over
  the document while state is a plain array. Meeting the rule in full therefore
  needs a decision on the shape of document state, such as a record keyed by
  object ID, before the three checks are worth restructuring. A reader will
  know it is finished when the cost of a refused batch stops growing with the
  size of the document across three sizes, the refusal and freeze tests in
  `mutation.test.ts` pass, and the differential test passes with a reference
  strategy that still rebuilds and checks everything.

The items below are the rest of the baseline that section 22 of `SPEC.md`
opens. Undo from section 21 is in place, so a paste that lands wrong can already
be taken back.

- Export a picture of the document or the selection, as specified in Moving data
  in and out. A reader will know it is finished when an exported raster of a
  document holding notation carries that notation, which a test asserts against
  the same document without it, and when the vector form and the canvas form
  share their geometry, text layout and measurement.
- Move objects and cells through the clipboard, as specified in Moving data in
  and out. A reader will know it is finished when a copied pair of wired objects
  pastes with its wiring pointing at the copies, a copied half keeps reading the
  original, a copied range reads into a spreadsheet in another window, and text
  pasted into a cell grows the table within the limits of section 7 and names
  the size it needed when it cannot.
- Read a comma separated file into a table, as specified in Moving data in and
  out. A reader will know it is finished when it shares the growth and refusal
  path of a paste.
- Warn about unsaved work and keep a recovery copy, as specified in Moving data
  in and out. A reader will know it is finished when leaving a dirty document
  warns, the window title shows the state, and a copy written on a timer is
  offered on the next open.

The items below are the graph surface that sections 19 and 20 open. The overlay
comes first, because rewiring and arrangement both read what it draws.

- Draw the dependency overlay behind a toggle, as specified in The dependency
  overlay. A reader will know it is finished when one curve stands for each
  ordered pair of objects and carries the count of slot edges behind it,
  hovering an object dims the rest, and a refused cycle draws its ring.
- Answer `upstream`, `downstream`, `orphans`, `broken` and `find` with a
  selection. A reader will know it is finished when each one leaves a selection
  that the ordinary commands then act on, and when `downstream` names the same
  slots a delete refusal names.
- Rewire a slot by dragging the reading end of a curve. A reader will know it is
  finished when the drag rewrites every occurrence of the old address in that
  formula, a drag closing a cycle refuses and names the slot, and a curve
  standing for more than one slot edge refuses the drag.
- Arrange, align and distribute, as specified in Arrangement. A reader will know
  it is finished when only literal positions move, the command reports how many
  it left alone, `arrange flow` ranks by the dependency depth the evaluation
  pass already computes, and the command refuses while undo is absent.

---

## Where the next items come from

Section 17 of `SPEC.md` lists what the team postponed on purpose. That list is
the boundary of the work, and an item moves here only when the spec releases
it. Python execution behind `evaluateScriptOutput` is the largest of them, and
section 11 of the spec holds the seam it arrives through.

An item that the spec does not cover needs the spec first. Write the
requirement there, then open the item here.
