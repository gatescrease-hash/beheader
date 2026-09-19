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

The four items below carry out Rule 5 of `SPEC.md`, which the engine does not
meet. The first stands alone. The second gates the two after it, because an
evaluation pass over part of a graph can leave a stale value where a pass over
all of it cannot, and a test that compares the two is what finds that.

- Resolve an address through a lookup keyed by object ID in `deriveEdges` and
  `validateIntegrity` of `src/engine/mutation.ts`. Each formula reference now
  scans the object array, which makes both phases grow with the square of the
  object count. A reader will know it is finished when both phases grow in
  proportion to the object count over a generated document, measured across at
  least three sizes, with every existing test still passing.
- Build the generator and the comparator for a differential test. It generates
  documents and mutation batches, applies each batch through two evaluation
  strategies it is given, and compares the resulting objects, journal, broken
  slots and refusal. The comparison rules in `RUST_PORT.md` describe the shapes
  to compare and where a tolerance is allowed. Both strategies are the full
  recomputation until the item below supplies a second one. A reader will know
  it is finished when a strategy carrying a deliberate staleness fault turns it
  red, and it runs in `npm test`.
- Evaluate the part of the graph that a mutation dirties, rather than every
  slot. Rule 6 supplies the affected set, because the slot set is fixed before
  evaluation begins. A reader will know it is finished when the differential
  test passes and the cost of one mutation over a generated document stops
  growing with the count of slots the mutation does not reach.
- Replace the deep clone of a transaction with sharing of the objects a batch
  does not touch. Rule 2 asks that a batch commit in full or leave the state
  untouched, which the clone currently makes true by construction, so this item
  carries tests for a refused batch leaving every object identical. A reader
  will know it is finished when those tests pass, the differential test passes,
  and the cost of a refused batch stops growing with the size of the document.

The items below are the baseline that sections 21 and 22 of `SPEC.md` open. Undo
comes first, because arrangement refuses to run without it and because a paste
that lands wrong is the gesture an operator most wants back.

- Give the journal an undo and a redo surface, as specified in Undo and redo.
  A reader will know it is finished when a gesture undoes as one step rather
  than one frame, a mutation after an undo drops the entries past the position,
  `nextObjectId` holds its value across an undo and a redo of a create, and the
  camera stays where it was.
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
