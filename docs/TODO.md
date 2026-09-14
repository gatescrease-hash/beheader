# TODO - Graphpaper

The open work, and nothing else. `STATUS.md` describes the code that exists,
and this file names the changes nobody has made yet.

Take an item, build it with its tests, run the four checks in `CLAUDE.md`, and
delete the item when it lands. Do not rewrite it into a record of the work.
Git holds what was done, and this file holds what is left.

A new item names the change, gives the reason, and says how a reader will know
it is finished. Anything else is a note, and a note belongs in the header of
the file it is about.

---

## Open

### 1. Decide the shape of the engine export surface

`src/engine/index.ts` re-exports every file in the engine with a star, so all
311 names cross the boundary while the layers outside use 114 of them. Replace
the stars with a hand written list of the names that are used, or write down
why the whole surface stays open. Either answer settles it.

The two tests in `index.test.ts` hold the boundary itself, and neither reads a
list that a person maintains, so a hand written list needs a third test that
fails when an export goes unused. Without one, the list rots the first time a
consumer drops an import.

Done when `index.ts` carries the decision in its header, and a test enforces
whichever shape wins.

### 2. Settle the name of the product

The spec calls the product Graphpaper. `package.json` carries `graphpaper`, and
the folder carries `beheader-clean`. Nothing in the code reads the folder name,
so the mismatch costs nothing today, and it costs a paragraph of explanation to
every person who clones the repository.

Done when one name reaches the folder, the package and the documents.

### 3. Build the math object

Section 12 of `SPEC.md` defines a math object. The language and the object type
are built, and an operator still cannot see one, because nothing draws it.

Each stage below lands with its tests, and each leaves the four checks clean.
Stages one to three together finish typing a formula, seeing it drawn, and
wiring it to the document. Solving comes after them, because none of that needs
it.

1. **The standalone form on screen.** The MathLive dependency, the overlay in
   `#stage` that draws the notation, the editable field, the measurer method
   behind both, and the `math` command word that creates one. The renderer, the
   hit test and the extent each carry a `math` case that draws nothing today,
   and this stage replaces all three. Done when an operator creates a math
   object from the command line, edits it in place, and watches its value follow
   an upstream cell.

2. **The block and inline forms inside a text object.** Done when one text box
   holds both forms, each redraws when the math object it reads changes, and a
   free bare name inside a math run is refused at parse time.

3. **The display modes.** The `source`, `value` and `both` settings, and the
   values the editor shows beside each free name. Done when the worked example
   of section 12 reads as an integral, as a number, and as both, and the panel
   lists ports above the rule with exports below it.

4. **A dotted address inside math source.** Section 12 says a dotted name such
   as `table_x.A1` resolves to a document address at parse time. The lexer
   refuses one today and names the input port that carries the value instead,
   which is a complete answer for wiring and a missing half of the spec. Done
   when a math source reads a document address directly, an edge derives from
   it, and a rename of the object it names rewrites nothing.

5. **Solving.** The seed slots, the iteration bound, and the error value for a
   solve that finds no root. Nothing of this is built, and the `seed` family of
   section 12 has no slot yet. Done when an implicit line returns the root
   nearest its seed, a change to the seed moves the answer from one root to
   another, and a solve that runs out of iterations gives an error value rather
   than a hung frame.

**Done when** all five stages have landed and this item is deleted.

---

## Where the next items come from

Section 16 of `SPEC.md` lists what the team postponed on purpose. That list is
the boundary of the work, and an item moves here only when the spec releases
it. Python execution behind `evaluateScriptOutput` is the largest of them, and
section 11 of the spec holds the seam it arrives through.

An item that the spec does not cover needs the spec first. Write the
requirement there, then open the item here.
