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

### 3. A Desmos style equation object

Table cells and text both hold arithmetic, and nothing in the document writes
mathematics the way mathematics is written. An operator who wants a definite
integral over a number that another object produces has nowhere to put it, and
`SUM` over a range is not an answer. This item adds a `math` primitive: an
object that holds equation lines in mathematical notation, takes named inputs
from anywhere in the document, and exposes every value it defines as a slot the
rest of the document can read.

Desmos is the model. Its editing behaviour is the part that is hard to design
and cheap to copy: a line reads as notation while the operator edits it, each
free name carries its current value beside it, and the value of the line
appears as soon as the line resolves.

The worked example this item has to satisfy, in the notation an operator would
write it:

```
x_ans = integral from 2 to 8 of sin(x_input) dx
```

`x_input` comes from somewhere else in the document. `x_ans` is a number that
anything else in the document can read.

**The three forms.** The request named them isolated, on its own line, and in
line. Call them standalone, block and inline.

- **Standalone** is an object on the canvas with its own origin, the same kind
  of citizen as a table or a text box.
- **Block** is a math run alone on a line inside a text object, laid out on a
  line of its own and centred across the width of the box.
- **Inline** is a math run inside a line of prose, with its baseline on the
  baseline of that line.

One parser and one layout routine serve all three. The form picks the box and
the baseline rule, and changes nothing else.

**The spec comes first.** No section of `SPEC.md` defines an equation object,
and section 15 does not postpone one either, so the spec is silent rather than
closed. The first stage below writes the requirement into `SPEC.md`. The
questions that section has to answer are the ones this item cannot settle on
its own, and each carries the answer that fits the rest of the design.

1. **Where the evaluator goes, against Rule 4.** Mathematical notation is a
   second language. It has binding forms, implicit multiplication, subscripts
   and calculus, and the formula language has none of those and gains nothing
   from them. The script node is the precedent that already exists for a second
   language inside the graph: its inner language is opaque, its ports are
   ordinary slots, and `evaluateScriptOutput` is the one function that stands
   between the two. A math object takes the same shape, so `graph/eval.ts` sees
   derived slots and never sees mathematics. Rule 4 bars a second evaluator for
   text, and this is not that, but the spec has to say so in Rule 4 rather than
   leave a reader to infer it.

2. **Which names cross the object boundary.** Section 6 already splits bare
   names from dotted names inside a table cell, where a bare `A1` means this
   table and a dotted name means the document. Math source uses the same split.
   A bare name is local to the object. A dotted name such as `table_x.A1` is a
   document address that the parser resolves to an ID, the same as any formula.
   So an operator can wire either way, and only one piece of code resolves an
   address.

3. **What a free name becomes.** A bare name that the source never defines is
   an input. On a standalone object it becomes a literal slot `math_1.in.speed`
   with a value the operator types, and `link` binds it to any upstream address,
   exactly as a script port does. In a text object there is nowhere to hang a
   port, so a free bare name inside a text math run is a parse error and the
   writer uses a dotted address instead.

4. **What a definition becomes.** A line of the form `name = expression` makes
   a derived slot `math_1.out.x_ans`. The exports go under `out` rather than at
   the top of the object for the same reason the script node puts them there:
   a bare export named `source`, `display` or `origin` would otherwise collide
   with a slot the schema declares, and a name an operator types must never be
   able to shadow the schema. A function definition such as `f(x) = x^2` makes
   no slot at all, because a slot holds a value and the `Value` union has no
   function member. Later lines in the same object can call it.

5. **Bound names.** An integral, a sum, a product and a function definition
   each bind a name over their body. The `x` in the worked example is bound by
   the integral and must never become an input port. The binder has to know
   every binding form before the port set is correct, and that is the part of
   the parser most likely to be wrong in a way tests catch late.

6. **Rule 6.** Both the port set and the export set come out of the source
   text, so the mutation that writes `source` parses it and adds or removes
   those slots in the same batch, and evaluation never reads `source` at all.
   This is the pairing that section 4 already describes for a port name and a
   port value: the integrity check needs every address a derived slot declares
   to be a real slot the moment the slot exists.

7. **How far the Desmos behaviour goes.** Desmos solves. It draws
   `x^2 + y^2 = 9` by finding the curve numerically, and a regression fits
   parameters to data. An implicit equation is a constraint, and section 15
   postpones constraint solving on purpose. So the first cut takes explicit
   definitions alone: `name = expression`, where the expression reads names
   already defined, and a line whose left side appears on its own right side is
   refused. A definite integral and a numeric derivative both stay, because a
   fixed quadrature over a definite range always stops, which is the property
   section 1 asks of the formula language. Plotting a function as a curve is a
   separate item and belongs to the geometry primitive rather than this one.

8. **The runtime dependency.** The Stack table says there are none, and the
   request allows one where writing it by hand would be foolish. The parts
   worth buying are display and editing, and they are both in the layer that
   gets thrown out anyway. KaTeX draws the notation. MathLive or MathQuill
   gives the editable math field, and that field is most of what makes Desmos
   feel the way it does. The part worth writing is the evaluator, because
   `src/engine/` is the directory that becomes a Rust crate and a JavaScript
   evaluator does not port. So the recommendation is two dependencies in
   `src/render/` and none in `src/engine/`. This one needs a human decision,
   because it rewrites a row of the Stack table.

9. **Measurement.** The inline form needs a width and a height before the line
   around it can break, and that size comes from the same library that draws
   the notation. `TextMeasurer` is the existing interface for a measurement
   that crosses into the engine, so it grows a method that measures one math
   run, `render/measure.ts` implements it, and a test supplies fixed sizes.
   Then `measuredWidth` and `measuredHeight` stay derived slots and Rule 1
   holds.

10. **Errors.** A line that fails to evaluate gives an error value on its
    export, and that value travels like any other. The `ErrorValue` union has a
    fixed set of codes, so the spec either adds one for a failed evaluation or
    says which existing code covers it.

**What the graph gives for nothing.** Because every export is a real slot and every
reference is a real edge, two lines inside one math object that define each
other in a circle are caught by the cycle check that already runs, with no new
code. The same is true across two math objects, and between a math object and a
table. That property holds only while edge derivation walks the parsed source,
so the derivation has to read the parse rather than a cached list of names.

**Display.** A literal slot `display` takes `source`, `value` or `both`. While
the operator edits, the object draws the source with each free name and its
current value beside it. Out of the editor, `display` picks what shows, so the
worked example reads as the integral under `source` and as `x_ans = 1.29` under
`value`. The properties panel already splits modifiable slots from derived
ones, so the ports land above the rule and the exports below it with no change
to the panel.

**Text syntax.** Section 9 parses text content into a block tree of text,
formula and conditional blocks, and this adds a fourth block type. `{$ ... }`
inside a line is the inline form, and a line holding `{$$ ... }` alone is the
block form. The text dependency walker already recurses the tree and calls
`extractDependencies` on every embedded AST, so it needs the math parse to
report its addresses through the same function.

**Command line.** `math x=0 y=0 "x_ans = ..."` creates one, and the editor
takes over from there. `props`, `link`, `unlink`, `set` and `refs` all work on
the new slots without a change, because the slots are ordinary.

**Stages.** The whole is too large for one change. Each stage below is a
landable change with its tests.

1. The spec section, answering the ten questions above.
2. The math language and the object type, together. The language is a lexer, a
   parser, an AST, a name binder and an evaluator in `src/engine/`, and the
   object type is a schema, the mutation that writes `source` and recomputes
   the two slot sets, and the derived slots. They land in one change because
   `STATUS.md` records that an inert module with thirty green tests shipped a
   real bug, and a language with no consumer is that module.
3. The standalone form on screen: the renderer, the editor, and the measurer
   method behind it.
4. The block and inline forms inside a text object.
5. The `display` modes and the free name values the editor shows.

**Done when** a document holds a math object whose source is the worked example
above, `math_1.in.x_input` is linked to a table cell, a typed change in that
cell moves `math_1.out.x_ans`, a text object shows that value through both the
inline and the block form, a circular pair of definitions is refused with a
message that names both slots, and the four checks in `CLAUDE.md` are clean.

---

## Where the next items come from

Section 15 of `SPEC.md` lists what the team postponed on purpose. That list is
the boundary of the work, and an item moves here only when the spec releases
it. Python execution behind `evaluateScriptOutput` is the largest of them, and
section 11 of the spec holds the seam it arrives through.

An item that the spec does not cover needs the spec first. Write the
requirement there, then open the item here.
