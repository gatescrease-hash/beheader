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

Section 12 of `SPEC.md` defines a math object. An operator can type one, see it
drawn, edit it in place, wire it to the document, and choose whether it shows
its formula, its result or both. The two in-text forms, a dotted address and
solving are open.

Each stage below lands with its tests, and each leaves the four checks clean.

1. **The block and inline forms inside a text object.** This is the largest of
   the three, because a text object is a string from end to end: `resolvedContent`
   is a string, `markdown.ts` parses a string, and `layOutText` breaks it into
   runs of text with a font each. Notation is none of those. Carrying it needs a
   piece kind that is not text threaded through that pipeline, and `STATUS.md`
   records that `measure.ts` and `renderer.ts` move together, so the change
   lands in both. Start by deciding what `resolvedContent` becomes when it can
   no longer be a string.
   Done when one text box holds a formula on its own line and another inside a
   sentence, the text around each lays out against the size of the notation
   rather than around a gap, and a free bare name inside a math run is refused
   at parse time.

2. **A dotted address inside math source.** Section 12 says a dotted name such
   as `table_x.A1` resolves to a document address at parse time, and the lexer
   refuses one today. Note first that a name of more than one letter is a
   product in mathematics, so `table_x` reads as five names multiplied and a
   document name has to arrive as `\operatorname{table_x}`. Decide whether that
   spelling is worth having next to an input port, which already carries any
   address without it, and write the answer into section 12 either way.
   Done when the spec and the lexer agree.

3. **Solving.** The seed slots, the iteration bound, and the error value for a
   solve that finds no root. Nothing of this is built, and the `seed` family of
   section 12 has no slot yet. Done when an implicit line returns the root
   nearest its seed, a change to the seed moves the answer from one root to
   another, and a solve that runs out of iterations gives an error value rather
   than a hung frame.

**Done when** all three stages have landed and this item is deleted.

### 4. Decide what a fresh input port holds

A free name the source has not been given a value for starts at zero, so a
math object whose first line is a fraction shows a division by zero the moment
it is typed. Zero is the honest answer for a number nobody has entered, and it
is also the one value that makes a denominator fail.

Done when a new port either starts at a value that reads as unset rather than
as zero, or the reason zero is right is written into section 12.

### 5. Complete an address as it is typed, and show what parsed

Every address is typed in full and spelled exactly, and a mistake is a refusal
after the fact rather than a warning during. The same address typed into ten
formulas is typed ten times. Nothing on screen separates a run of text that the
program read as an address from a run that happens to look like one.

**What is already right, and what is not.** A stored AST holds `Address`
records carrying an object ID, so an address in a committed formula is not text
and a rename rewrites nothing. The problem is at the two ends, entry and
display, and in math source, where `table_x` lexes as five letters multiplied
because juxtaposition is multiplication. So this item builds an input layer and
changes no stored shape.

**Derive the appearance, do not bake a token.** A completed address could
become a token in the field that carries its own identity and its own
appearance. It should not. A token that carries an identity can drift from the
text beside it, and then what the operator sees and what the parser reads are
two answers to one question, which is the fault this item exists to remove.
Instead the field parses what it holds on every keystroke and paints the spans
that resolved. A hand typed address then lights up without a completion, and a
misspelt one visibly fails to light up before anything is committed.

The exception is math source, where an address cannot be parsed out of the
notation at all. That needs a spelling of its own, and the last stage covers it.

**Stages.** Each lands with its tests and leaves the four checks clean.

1. **Completion, and the Tab that drives it.** `completeAddress` in the engine
   takes a partial string and the objects and returns the candidates, in two
   phases: an object name first, then a slot path of that object. The registry
   in `command/parser.ts` gains an `address` argument kind, because it declares
   `link` and `refs` as taking text today and only `commands.ts` knows better.
   `completeCommandLine` then answers what a Tab at a given cursor should do.
   Tab fills the longest common prefix, a second Tab cycles the candidates, and
   a completed object name takes a dot and offers its slots. The command line
   drives it in the same change, because `STATUS.md` records that a module with
   no consumer ships a real bug.
   Done when Tab completes an object name, a second Tab completes a slot of it,
   an ambiguous prefix fills as far as it is unambiguous and stops, and the four
   registry sweeps carry the new argument kind.

2. **Paint what parsed, in the command line.** A mirror element under the input
   paints one span for each token the parse recognised, and an address that
   resolved reads as a code font on a grey ground. The input stays an ordinary
   input holding an ordinary string, so `parser.ts` reads exactly what it reads
   today. A `contenteditable` field would take that property away and bring
   selection, undo and input method handling with it.
   The mirror carries the same risk `.text-editor` already carries: it agrees
   with the input about font, padding and scrolling, or it drifts a character at
   a time. That pair belongs in the invariants of `STATUS.md`.
   Done when an address that resolves is painted and a misspelt one is not,
   both at the first keystroke that decides it.

3. **The same two things in a formula field.** A table cell, a panel row and the
   formula half of a `set` all take a formula rather than a command, so the
   spans come from the formula lexer, which already carries a start for every
   token. Done when a cell being edited paints its addresses and completes them.

4. **An address inside math source.** A macro such as `\gpref{table_x.A1}`
   gives notation a spelling for an address that the lexer can read as one
   token, which juxtaposition cannot break and which draws as a chip without
   any work. It answers the question the math item leaves open, so that stage
   and this one settle together.
   Done when the spec says how an address is spelled in notation and the lexer
   agrees.

**Done when** all four stages have landed and this item is deleted.

### 6. Say what the program understood, on a refusal

A refusal names the slot it is about, which the spec asks for, and it does not
say what was typed instead. An operator who misspells an object name is told
that no object carries that name, and the name they meant is one edit away and
on screen already.

This rides on the completion of item 5, which computes the candidates a name
could have meant. Done when a refusal that names a missing object or slot also
names the nearest one that exists.

---

## Where the next items come from

Section 16 of `SPEC.md` lists what the team postponed on purpose. That list is
the boundary of the work, and an item moves here only when the spec releases
it. Python execution behind `evaluateScriptOutput` is the largest of them, and
section 11 of the spec holds the seam it arrives through.

An item that the spec does not cover needs the spec first. Write the
requirement there, then open the item here.
