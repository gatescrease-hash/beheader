# STYLE - how to write a comment here

This file is the fixed reference for prose in this repository. It holds the
rules, and one worked example of the same file header written badly and then
written well. Read the example first. The rules below it are the reasons that
example changed.

`tools/prose-check.mjs` enforces the rules a machine can judge. A person judges
the rest, against the example.

---

## 1. The worked example

This is a real file header, `src/engine/journal.ts`, before and after.

### Bad

```
 * The reader of the append only journal that mutation.ts writes. It rebuilds
 * the objects of a document as they stood after any entry. It runs the same
 * operations again over an empty document.
 *
 * The simplest correct code matters more here than speed. A replay runs one
 * mutation for each entry, and it keeps no snapshot. Undo reads the state
 * before the last entry as replayJournal(journal, journal.length - 1).
 *
 * Two traps. A replay rebuilds objects and nothing else, because nextObjectId
 * and the camera never enter the journal, so the caller keeps its own. And a
 * journal is complete only for a document that every mutation built. A
 * document that arrives any other way needs journalIsComplete before anything
 * trusts a replay of it.
```

### Good

```
 * Reads back the append-only journal that mutation.ts writes. replayJournal
 * rebuilds a document's objects as they stood after any entry, by re-running
 * those entries over an empty document.
 *
 * Replays are unoptimized for the sake of simplicity: one mutate() call per
 * entry, with no snapshots. Undo is replayJournal(journal, journal.length - 1).
 * An entry that fails to replay aborts the whole replay and reports which entry
 * broke, instead of handing back a half-built document.
 *
 * The journal has two limitations. First, a replay restores objects only. The
 * nextObjectId counter and the camera never go into the journal, so whoever
 * calls replayJournal tracks those two separately. Second, a journal is only
 * trustworthy for a document where every change went through mutate(). For a
 * document that arrived some other way, such as a loaded file,
 * journalIsComplete answers whether the journal accounts for it: it replays
 * everything and compares the result against the objects the caller passes in.
```

### What changed, and why

| Bad | Good | Why |
| --- | --- | --- |
| "The simplest correct code matters more here than speed." | "Replays are unoptimized for the sake of simplicity." | The bad line judges a priority and paraphrases a project rule. The good line states a property of this code that a reader can act on. |
| "it keeps no snapshot" | "with no snapshots" | A preposition carries a negative better than a verb of possession does. Four words shorter, and it reads like English. |
| "Two traps." | "The journal has two limitations. First, ... Second, ..." | A two word verdict announces and then stops. The good version names the limitation, spells it out, and says who is responsible for what. |
| "so the caller keeps its own" | "so whoever calls replayJournal tracks those two separately" | Its own what? The bad version compressed until the meaning became a puzzle. |
| "a journal is complete only for a document that every mutation built" | "a journal is only trustworthy for a document where every change went through mutate()" | The good version names the function, so a reader knows what to look for. |

The good version is longer. That is the point. It is economical with grammar
and generous with meaning. The bad version is the reverse.

---

## 2. The rules

A comment explains the code to a person reading it for the first time. It says
what the code is and why it has this shape. It does not give orders to whoever
edits the file next.

1. **Describe the code. Do not direct the reader.** A limit appears as a fact
   about the code. Write "The file works on plain data alone", not "This file
   must never touch the DOM".
2. **Give every constraint its purpose.** A sentence that names a limit says
   why the limit holds.
3. **Write whole sentences.** Each one needs a subject and a verb. `Layer:
   engine.` and `Pure logic.` are labels, not sentences.
4. **State a fact once.** Cut the colourful version when the plain one is
   there. Cut an adjective that the noun already carries.
5. **Use plain words.** "heavily relied upon" beats "load bearing". A domain
   term with an exact meaning stays.
6. **Let `never` and `every` describe behaviour, not duty.** "An ID never
   changes" is a fact. "This file must never import the DOM" is an order.
7. **Open with what the file is.** The layer and the import limits come after,
   each with its reason.
8. **Connect the sentences.** Where one idea causes the next, write the link.
9. **State a concrete property, not a value judgment.** Write "this code is
   unoptimized for the sake of simplicity", not "the simplest correct code
   matters more than speed". Words like `matters`, `earns`, `is what keeps`
   and `at work` are a sign that a sentence has stopped describing anything.
10. **Carry a negative with a preposition.** Write "with no snapshots", not
    "it keeps no snapshot". A verb of possession plus `no` reads badly, and it
    costs a clause.
11. **Do not announce.** No `Two traps.` or `Three readers.` before the
    content. Say the thing itself. A lead-in that sets up `First` and `Second`
    is fine when it is a whole sentence.
12. **Clarity beats brevity.** There is no word limit. Name the identifier,
    spell out the referent, and say who is responsible. A reader who
    understands a sentence on the first pass costs less than the words saved.

Also:

- Name the actor. Use the active voice where it reads better, and the passive
  where it does not.
- Do not use a semicolon, a long dash, a contraction, or capitals for emphasis.
- Do not cite a rule or a section by number. Numbers drift apart between two
  files. State the fact the number stands for.
- Do not write the history of a decision. The purpose of the code belongs in
  the comment, because it is still true. The story of how the code reached that
  shape belongs in `docs/STATUS.md`.

---

## 3. The header of a file

A header answers three questions:

- What does this file do?
- What layer is it in, and what can it import, and why?
- What surprise waits for a reader who changes it?

Then read it again and cut the words that carry nothing. Cutting words is not
the same as cutting meaning. Rule 12 outranks a shorter draft.

---

## 4. A comment inside a file

Write one only where the code cannot speak for itself. Read the file as if you
have never seen it, and ask of each function whether its name and its body
already answer the question. A comment that repeats the next line is noise. A
comment that gives the reason behind a choice the code cannot state is worth
the space.

---

## 5. Why ASD-STE100 is gone

This repository used to hold its prose to ASD-STE100 Simplified Technical
English: a 25 word sentence limit, no verb in the -ing form, no passive voice,
and an approved vocabulary.

That standard is built for aircraft maintenance instructions, read under time
pressure by people who do not speak English as a first language. It prevents
ambiguity in an instruction. It is a poor fit for an explanation of why code
has the shape it has, and its limits produced the bad example in section 1. The
word limit is what compressed "so the caller keeps its own" into a puzzle, and
the ban on the -ing form and the passive voice pushed every other sentence into
the same clipped shape.

The rules that survived are in section 2. They survived on merit, and not
because a standard named them.
