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

The item below finishes Rule 5 of `SPEC.md`. Slot writes, cell clears,
creates, renames and deletes without force read the index in
`graph/graph-index.ts` and cost what they affect. The operations below still
derive, check and search the whole document, which over a value chain of 16000
objects costs 150 to 250 milliseconds.

- Carry the indexed path in `mutation.ts` to the remaining structural
  operations: resizing a table and writing its extent, adding, deleting and
  splitting vertices, exploding a path, adding and removing ports, writing a
  math source, creating, clearing and renaming a document variable, writing a
  layer membership, and deleting with force. Each rewrites the formulas of the
  objects that name its target, which the index can now find through its
  referrers, or changes a name that text and the name checks read, which the
  word and name maps cover. A forced delete also reports broken slots in list
  order, which an identity pass over the list can give. A refusal can keep the
  whole-document path. A reader will know it is finished when each of those
  operations reads the same number of object records at three document sizes,
  in the way `mutation.test.ts` measures a create, and the differential
  generator produces each of them.

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

The items below are the graph surface that sections 19 and 20 open. The overlay
comes first, because rewiring and arrangement both read what it draws.

- Draw the dependency overlay behind a toggle, as specified in The dependency
  overlay. A reader will know it is finished when one curve stands for each
  ordered pair of objects and carries the count of slot edges behind it,
  hovering an object dims the rest, and a refused cycle draws its ring.
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
it. Python packages beyond the standard library, and port discovery from the
reads a script makes, are the next of them that section 11 points at.

An item that the spec does not cover needs the spec first. Write the
requirement there, then open the item here.
