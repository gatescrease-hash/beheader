#!/usr/bin/env node
/**
 * prose-check.mjs
 *
 * Checks the comments and documents of this repository against the rules in
 * docs/STYLE.md. It reads the prose out of a file, strips the code back out of
 * it, and reports each sentence that breaks a rule a machine can judge. A
 * person judges the rest, against the worked example in that file.
 *
 * The script takes one or more paths. The --all flag reads the whole
 * repository, and --quiet prints the summary alone.
 *
 *   node tools/prose-check.mjs <path> [more paths]
 *   node tools/prose-check.mjs --all
 *   node tools/prose-check.mjs --all --quiet
 *
 * It gives exit code 1 when it finds a fault, and exit code 0 when the prose
 * is clean.
 *
 * This script used to check ASD-STE100 Simplified Technical English. That
 * standard is built for aircraft maintenance instructions, and its sentence
 * limit and its ban on the -ing form pushed every comment into the same
 * clipped shape. Section 5 of docs/STYLE.md holds the reasoning.
 */

import { basename, join, extname } from "node:path";
import { readFileSync, readdirSync, statSync } from "node:fs";

/* ------------------------------------------------------------------ */
/* Word lists                                                          */
/* ------------------------------------------------------------------ */

/**
 * Words and phrases that make text sound like a chat assistant. Most of them
 * add nothing.
 */
const CHAT_STYLE = [
  "delve", "leverage", "leverages", "robust", "seamless", "seamlessly",
  "crucial", "crucially", "comprehensive", "holistic", "elegant",
  "elegantly", "powerful", "rich set", "nuanced", "landscape", "realm",
  "tapestry", "underscore", "underscores", "pivotal", "intricate",
  "meticulous", "meticulously", "showcase", "showcases", "unlock", "unlocks",
  "harness", "empower", "empowers", "streamline", "streamlines",
  "cutting-edge", "game-changer", "deep dive", "dive into", "at its core",
  "it is worth noting", "it is important to note", "it should be noted",
  "the key insight", "in essence", "essentially", "fundamentally", "notably",
  "arguably", "certainly", "simply put", "in a nutshell", "let us",
  "we can see", "as we can see", "boils down to", "under the hood",
  "first-class", "battle-tested", "opinionated", "ergonomic", "idiomatic",
  "canonical",
];

/**
 * Figures of speech that a plain word says better. The left side is the
 * figure, and the right side is a word that carries the same meaning.
 */
const METAPHOR = {
  "load bearing": "heavily relied upon",
  "load-bearing": "heavily relied upon",
  "lives here": "is defined here",
  "live here": "are defined here",
  "sits here": "is defined here",
  "sit here": "are defined here",
  "falls out": "follows",
  "throwaway": "short lived",
};

/**
 * Phrases that judge a value instead of stating a property. Rule 9 of
 * docs/STYLE.md replaces each one with a fact about the code. A sentence that
 * ranks one thing above another has stopped describing anything.
 */
const VALUE_JUDGMENT = [
  "matters more", "matters less", "is what keeps", "is what makes",
  "is what lets", "is what allows", "is what does", "is what gives",
  "at work", "earns its", "earns their", "worth the space", "the whole story",
  "is the point", "that is the point", "the real work", "does the heavy",
];

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A word boundary on each side, so a real word such as delvertex does not
// match the shorter one.
const CHAT_STYLE_PATTERNS = CHAT_STYLE.map((phrase) => ({
  phrase,
  re: new RegExp("\\b" + escapeRegExp(phrase) + "\\b"),
}));

const VALUE_PATTERNS = VALUE_JUDGMENT.map((phrase) => ({
  phrase,
  re: new RegExp("\\b" + escapeRegExp(phrase) + "\\b"),
}));

/**
 * Documents that state a requirement or give an instruction. A specification
 * says what to build, and a guide tells a reader what to do, so both need the
 * register that the rules take away. Every other document describes the code
 * that exists, the same as a comment does.
 */
const DIRECTIVE_DOCUMENTS = new Set(["SPEC.md", "CLAUDE.md", "STYLE.md"]);

/**
 * How long a cell in a Markdown table can be. A row of the structure map in
 * docs/STATUS.md routes a reader to a file, and a row that outgrows this cap
 * has become a second copy of that file's header.
 */
const MAX_TABLE_CELL_WORDS = 30;

/** Short capital words that are names, not loud emphasis. */
const ACRONYMS = new Set([
  "TS", "JS", "JSON", "DOM", "API", "ID", "IDS", "AST", "DAG", "CSS", "HTML",
  "URL", "UI", "CLI", "RGB", "OK", "NOT", "MUST", "NEVER", "ONLY", "ALL",
  "PNG", "JPG", "SVG", "GPU", "CPU", "IO", "UTF", "MD", "STE", "ASD", "XY",
  "SPEC", "CAD", "DXF", "IPC", "RAM", "URI", "CSV", "TODO", "ASCII", "NaN",
  "STATUS", "STYLE", "GPL", "MIT", "DFS", "REF", "AND", "OR", "IF", "SUM",
  "MIN", "MAX", "AVG", "ABS", "POW", "LEN", "PI", "SIN", "COS", "TAN", "DEG",
  "RAD", "TRUE", "FALSE", "NULL", "TYPE", "DIV0", "PARSE", "SCRIPT", "MEASURE",
]);

/* ------------------------------------------------------------------ */
/* Extraction                                                          */
/* ------------------------------------------------------------------ */

/**
 * Reads the comments out of TypeScript or JavaScript source. A small scanner
 * walks the file and keeps track of string literals, so a comment marker
 * inside a string does not start a false comment.
 *
 * Returns a list of records. Each record holds a line number and the text.
 */
function extractComments(source) {
  const out = [];
  let line = 1;
  let i = 0;
  const n = source.length;
  let lastSignificant = "";

  const canStartRegex = () =>
    lastSignificant === "" || "(,=:[!&|?{};+-*%~^".includes(lastSignificant);

  while (i < n) {
    const c = source[i];
    const d = source[i + 1];

    if (c === "\n") { line++; i++; continue; }
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }

    if (c === "/" && d === "/") {
      const start = line;
      let text = "";
      i += 2;
      while (i < n && source[i] !== "\n") text += source[i++];
      // A run of line comments is one comment. A record for each line cuts a
      // sentence at the line break, and a rule that reads a sentence then
      // judges half of one.
      const last = out[out.length - 1];
      if (last !== undefined && !last.block && last.endLine === line - 1) {
        last.text += " " + text;
        last.endLine = line;
      } else {
        out.push({ line: start, text, endLine: line });
      }
      continue;
    }

    if (c === "/" && d === "*") {
      const start = line;
      let text = "";
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") line++;
        text += source[i++];
      }
      i += 2;
      out.push({ line: start, text, block: true });
      continue;
    }

    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === "\\") i++;
        else if (source[i] === "\n") line++;
        i++;
      }
      i++;
      lastSignificant = "x";
      continue;
    }

    if (c === "/" && canStartRegex()) {
      i++;
      let guard = 0;
      while (i < n && source[i] !== "/" && source[i] !== "\n" && guard++ < 400) {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i] === "[") {
          while (i < n && source[i] !== "]") {
            if (source[i] === "\\") i++;
            i++;
          }
        }
        i++;
      }
      i++;
      lastSignificant = "x";
      continue;
    }

    lastSignificant = c;
    i++;
  }
  return out;
}

/**
 * Reads the prose out of an HTML file: its comments, and its CSS comments.
 *
 * One comment becomes one record, even where it covers many lines. A record
 * for each line cuts a sentence at the line break, and every rule that reads
 * a sentence then judges half of one.
 */
function extractHtml(source) {
  const out = [];
  const open = /<!--|\/\*/g;
  let line = 1;
  let at = 0;
  let match;
  while ((match = open.exec(source)) !== null) {
    if (match.index < at) continue;
    for (let k = at; k < match.index; k++) if (source[k] === "\n") line++;
    const isHtml = match[0] === "<!--";
    const closer = isHtml ? "-->" : "*/";
    const from = match.index + match[0].length;
    let to = source.indexOf(closer, from);
    if (to === -1) to = source.length;
    const text = source.slice(from, to);
    out.push({ line, text });
    for (let k = match.index; k < to; k++) if (source[k] === "\n") line++;
    at = to + closer.length;
    open.lastIndex = at;
    line += 0;
  }
  return out;
}

/**
 * Reads the prose out of a Markdown file. A code block and a table header go
 * away, and a table row becomes one record for each cell. A heading carries a
 * mark, because a heading names a section and a name is a label by design.
 *
 * A run of plain lines joins into one record, because Markdown wraps a
 * paragraph across lines. A record for each line cuts a sentence at the wrap,
 * and a rule that reads a sentence then judges half of one.
 */
function extractMarkdown(source) {
  const out = [];
  const lines = source.split("\n");
  let inFence = false;
  let para = null;
  const endParagraph = () => { if (para !== null) out.push(para); para = null; };
  for (let k = 0; k < lines.length; k++) {
    const raw = lines[k];
    if (/^\s*```/.test(raw)) { endParagraph(); inFence = !inFence; continue; }
    if (inFence) continue;
    // An indented line under an open list item continues that item. The same
    // indent at the top level opens a code block, which is not prose.
    if (/^\s{4,}\S/.test(raw) && !(para !== null && para.list === true)) {
      endParagraph();
      continue;
    }
    if (/^ *[|][ -:|]*$/.test(raw)) { endParagraph(); continue; }
    if (/^ *[|]/.test(raw)) {
      endParagraph();
      // A row that a divider follows names the columns. A column name is a
      // label by design, so the rules fight every table in the file.
      const divider = /^ *[|][ -:|]*$/.test(lines[k + 1] ?? "");
      if (!divider) {
        out.push({ line: k + 1, text: raw.replace(/[|]/g, ". "), table: true });
      }
      continue;
    }
    if (raw.trim() === "" || /^ *#/.test(raw)) {
      endParagraph();
      if (raw.trim() !== "") out.push({ line: k + 1, text: raw, heading: true });
      continue;
    }
    // A list item opens a record of its own, and its wrapped lines join it.
    const startsItem = /^\s*([-*+]|\d+\.)\s/.test(raw);
    if (startsItem) endParagraph();
    if (para === null) para = { line: k + 1, text: raw, list: startsItem };
    else para.text += " " + raw;
  }
  endParagraph();
  return out;
}

/* ------------------------------------------------------------------ */
/* Cleaning                                                            */
/* ------------------------------------------------------------------ */

/**
 * Removes everything that is code, not prose. The result is the English text
 * that the rules apply to.
 */
function stripCode(text) {
  return text
    .replace(/^ *[*] {2,}[^ ].*$/gm, " zc. ")
    .replace(/^\s*\*+ ?/gm, " ")
    .replace(/`[^`]*`/g, " zc ")
    .replace(/"[^"]{0,80}"/g, " zq ")
    .replace(/https?:\/\/\S+/g, " zc ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[A-Za-z_$][\w$]*\s*\([^)]*\)/g, " zc ")
    .replace(/[\w$]+(?:\.[\w$]+)+/g, " zc ")
    .replace(/[\w$]*_[\w$]*/g, " zc ")
    .replace(/\b[a-z]+[A-Z][\w$]*/g, " zc ")
    .replace(/\b[\w-]+\.(ts|js|mjs|json|html|css|md)\b/g, " zc ")
    .replace(/\S*\/\S*/g, " zc ")
    .replace(/[#§]\s?[\d.]+/g, " zr ")
    .replace(/\b[A-Z]-\d+\b/g, " zr ")
    .replace(/\b\d[\d.,%x-]*\b/g, " zn ")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*#+\s*/gm, "")
    .replace(/\*\*|__|\*|_/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cuts cleaned prose into sentences. */
function sentences(text) {
  if (!text) return [];
  // A code placeholder (zc, zr, zn, zq) can open a sentence too. stripCode always
  // lowercases it, so the plain capital-letter test alone misses it and
  // merges two real sentences into one.
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z"(]|z[crnq]\b)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}


/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */

const CONTRACTIONS =
  /\b(?:can't|won't|don't|doesn't|didn't|isn't|aren't|wasn't|weren't|hasn't|haven't|hadn't|shouldn't|wouldn't|couldn't|it's|that's|there's|here's|what's|let's|we're|they're|you're|i'm|we've|they've|you've|we'll|they'll|you'll|it'll)\b/i;

/**
 * Verbs that open an order. A comment describes the code, so a sentence that
 * opens with one of these speaks to a reader instead of about the code.
 */
const IMPERATIVE_OPEN =
  /^(Do|Use|Read|Write|Keep|Make|Set|Put|Add|Remove|Call|Check|Give|Take|Start|Stop|Send|Open|Close|Find|Show|Move|Draw|Never|Always|Prefer|Avoid|Treat|Ask|Update|Run|Pick|Cut|Leave|Change|Import|Note|Consider|Ensure|Remember|Let|Think|Try|Look|Hold|Wire|Load|Skip|Reuse|Follow|Trust|Assume)\b/;

/** Words that hand a duty to a reader rather than state a fact. */
const OBLIGATION = /\b(must|do not|don't|you|your)\b/i;

/** A colon label that stands in place of a sentence, such as "Layer: engine". */
const LABEL_OPEN = /^(?:z[crnq] )?[A-Z][a-z]+ *:/;

/**
 * A verb of possession in front of "no". Rule 10 of docs/STYLE.md carries the
 * negative with a preposition instead, so "it keeps no snapshot" becomes "with
 * no snapshots".
 */
const NEGATIVE_POSSESSION =
  /\b(keeps?|holds?|needs?|sets?|carries|carry|makes?|takes?|gets?|owns?|wants?|leaves?|offers?|gives?|shows?|draws?|reads?|writes?|accepts?|returns?) no\b/i;

/**
 * Verbs that carry a sentence without an -s or -ed ending. A whitelist of
 * every verb is impossible to keep, so the fragment test asks a narrower
 * question: does any word here look like a verb at all?
 */
const BARE_VERB =
  /\b(is|are|was|were|be|has|have|had|does|do|did|can|cannot|will|go|come|hold|keep|give|take|make|read|write|need|want|get|put|call|show|set|draw|run|add|mean|use|cover|stay|sit|turn|name|carry|become|exist|belong|depend|return|work|live|fail|pass|move|change|pick|refuse|allow|leave|know|own|declare|build|parse|split|join|reach|apply|start|stop|open|close|find|serve|treat|prefer|avoid|end|begin|cost|prove|follow|throw|drive|paint|feed|beat|accept|send|break|count|measure)\b/i;

/**
 * Answers whether a short run of words holds a verb. A word that ends in -s
 * or -ed can be a verb, and so can a word from the bare list. A label such as
 * "The drag handle" holds none of the three.
 */
function looksLikeSentence(sentence) {
  if (BARE_VERB.test(sentence)) return true;
  return sentence
    .split(/\s+/)
    .some((w) => /^[a-z]{3,}(s|ed)$/i.test(w.replace(/[^A-Za-z]/g, "")));
}

/** Runs every rule against one sentence. Returns a list of fault records. */
function checkSentence(sentence, record, describesCode, inTable) {
  const faults = [];
  const add = (rule, detail, fix) =>
    faults.push({ rule, detail, fix, ...record });

  const words = sentence.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  const low = sentence.toLowerCase();

  if (describesCode) {
    const duty = sentence.match(OBLIGATION);
    if (duty) {
      add("obligation", duty[0],
        "State the fact about the code, and give the reason for it.");
    }
    if (IMPERATIVE_OPEN.test(sentence)) {
      add("imperative", words[0],
        "A comment describes the code. Name the actor and say what it does.");
    }
    // A cell in a table is a label by design, the same as a column name or a
    // heading. The routing map in docs/STATUS.md is built out of them.
    if (!inTable) {
      if (LABEL_OPEN.test(sentence)) {
        add("fragment", words[0], "Write a sentence with a subject and a verb.");
      } else if (words.length <= 5 && !looksLikeSentence(sentence)) {
        add("fragment", sentence, "Write a sentence with a subject and a verb.");
      }
    }
    const negative = sentence.match(NEGATIVE_POSSESSION);
    if (negative) {
      add("negative-possession", negative[0],
        'Carry the negative with a preposition, such as "with no snapshots".');
    }
    for (const { phrase, re } of VALUE_PATTERNS) {
      if (re.test(low)) {
        add("value-judgment", phrase,
          "State a property of the code that a reader can act on.");
      }
    }
  }

  const contraction = sentence.match(CONTRACTIONS);
  if (contraction) add("contraction", contraction[0], "Write the words in full.");

  if (/;/.test(sentence)) {
    add("semicolon", ";", "The user refuses semicolons. Use two sentences.");
  }
  if (/[—–]/.test(sentence)) {
    add("dash", "long dash", "Use a full stop or a comma.");
  }

  for (const { phrase, re } of CHAT_STYLE_PATTERNS) {
    if (re.test(low)) {
      add("chat-style", phrase, "Delete it or say the fact plainly.");
    }
  }

  for (const [figure, plain] of Object.entries(METAPHOR)) {
    if (new RegExp("\\b" + escapeRegExp(figure) + "\\b", "i").test(low)) {
      add("metaphor", figure, 'Use the plain word. Try "' + plain + '".');
    }
  }

  const shout = sentence.match(/\b[A-Z]{3,}\b/g) || [];
  for (const s of shout) {
    if (!ACRONYMS.has(s)) {
      add("shouting", s, "Do not use capitals for emphasis.");
    }
  }

  return faults;
}

/* ------------------------------------------------------------------ */
/* Driver                                                              */
/* ------------------------------------------------------------------ */

function checkFile(path) {
  const source = readFileSync(path, "utf8");
  const ext = extname(path);
  const blocks =
    ext === ".md"
      ? extractMarkdown(source)
      : ext === ".html"
        ? extractHtml(source)
        : extractComments(source);
  const faults = [];
  const describesCode = !DIRECTIVE_DOCUMENTS.has(basename(path));

  for (const block of blocks) {
    // A row of the structure map routes a reader to a file. Anything longer is
    // a second copy of that file's header, which drifts because an edit to the
    // file never shows it to anybody.
    if (block.table === true) {
      for (const cell of block.text.split("|")) {
        const words = stripCode(cell).split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
        if (words.length > MAX_TABLE_CELL_WORDS) {
          faults.push({
            rule: "table-row",
            detail: words.length + " words, limit " + MAX_TABLE_CELL_WORDS,
            fix: "Move the detail into the header of the file the row names.",
            file: path,
            line: block.line,
            sentence: words.slice(0, 14).join(" ") + " ...",
          });
        }
      }
    }
    const clean = stripCode(block.text);
    for (const sentence of sentences(clean)) {
      // A placeholder stands for code, so a run that holds one or none of
      // them is a stray reference rather than prose. Two real words are
      // enough to judge, which is what catches a label such as "Two traps".
      const real = sentence
        .split(/\s+/)
        .filter((w) => /[A-Za-z]/.test(w))
        .filter((w) => !["zc", "zr", "zn", "zq"].includes(w.toLowerCase().replace(/[^a-z]/g, "")));
      if (real.length < 2) continue;
      faults.push(
        ...checkSentence(
          sentence,
          { file: path, line: block.line, sentence },
          describesCode && block.heading !== true,
          block.table === true
        )
      );
    }
  }
  return faults;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "dist") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if ([".ts", ".js", ".mjs", ".md", ".html"].includes(extname(full))) out.push(full);
  }
  return out;
}

const args = process.argv.slice(2);
const targets = args.includes("--all")
  ? walk(".")
  : args.filter((a) => !a.startsWith("--"));
const quiet = args.includes("--quiet");

let total = 0;
const byRule = {};
const byFile = {};
for (const path of targets) {
  let faults;
  try {
    faults = checkFile(path);
  } catch (error) {
    console.error(path + ": cannot read. " + error.message);
    continue;
  }
  for (const fault of faults) {
    total++;
    byFile[fault.file] = (byFile[fault.file] ?? 0) + 1;
    byRule[fault.rule] = (byRule[fault.rule] ?? 0) + 1;
    if (!quiet) {
      console.log(fault.file + ":" + fault.line + "  [" + fault.rule + "] " + fault.detail);
      console.log("    " + fault.sentence.slice(0, 160));
      console.log("    -> " + fault.fix);
    }
  }
}

console.log("\n" + total + " fault(s) in " + targets.length + " file(s).");
if (total > 0) {
  console.log(
    Object.entries(byRule)
      .sort((a, b) => b[1] - a[1])
      .map(([r, c]) => "  " + r + ": " + c)
      .join("\n")
  );
  if (quiet) {
    console.log("\nWorst files:");
    console.log(
      Object.entries(byFile)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([f, c]) => "  " + c + "  " + f)
        .join("\n")
    );
  }
}
process.exit(total > 0 ? 1 : 0);
