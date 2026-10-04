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

The item below finishes Rule 5 of `SPEC.md`. A batch that writes slots which
already exist reads the index in `graph/graph-index.ts` and costs what it
affects. Every other batch still derives, checks and searches the whole
document, which over value chains of 1000, 4000 and 16000 objects took about
1.8, 6.3 and 33 milliseconds for a refusal at the integrity check.

- Carry the indexed path in `mutation.ts` to structural batches: creating,
  deleting and renaming objects, resizing a table, adding and removing
  vertices and ports, creating and clearing slots, and writing a table extent
  or a layer membership. Each changes which objects read which, so the index
  needs a record of the objects that name each object, including names inside
  text content and math sources, before the batch can tell whose edges to
  derive again. The preflight checks at the top of `mutate` read every object
  for every batch too, through the name list, the port map and the math
  source map, and each needs the same index. A refusal can keep the
  whole-document path, because its message lists slots in the order that pass
  meets them. A reader will know it is finished when a create, a delete and a
  rename each read the same number of object records at three document sizes,
  in the way `mutation.test.ts` already measures an edit, and the differential
  test passes over generated scenarios that include those operations.

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
