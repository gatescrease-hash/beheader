#!/usr/bin/env node
/**
 * ste-check.mjs - a prose checker for this repository.
 *
 * Purpose. Every comment, header and document here must follow ASD-STE100
 * Simplified Technical English. This script reads the prose out of a file and
 * reports each line that breaks a rule. Code is not prose, so the script
 * removes all code before it starts.
 *
 * Use.
 *   node tools/ste-check.mjs <path> [more paths]
 *   node tools/ste-check.mjs --all
 *   node tools/ste-check.mjs --all --quiet
 *
 * The script gives exit code 1 if it finds a fault. If the prose is clean,
 * the script gives exit code 0.
 *
 * Scope. The script checks the rules that a machine can check: sentence
 * length, active voice, verb form, word choice, punctuation and noun
 * clusters. A person must still check the rules that need judgement.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

/* ------------------------------------------------------------------ */
/* Word lists                                                          */
/* ------------------------------------------------------------------ */

/**
 * Words that ASD-STE100 does not approve, and the approved word to use. The
 * standard holds about 900 approved words. This list holds the words that
 * technical writers use most often by mistake.
 */
const NOT_APPROVED = {
  abort: "stop", accomplish: "do", additionally: "also", additional: "more",
  adjacent: "near", aforementioned: "this", alter: "change",
  alternatively: "or", ascertain: "find", assist: "help", attempt: "try",
  attempts: "tries", cease: "stop", commence: "start", comprise: "have",
  comprises: "has", concerning: "about", consequently: "so",
  considerable: "large", constitute: "form", denote: "show", denotes: "shows",
  depict: "show", depicts: "shows", desire: "want", deviate: "differ",
  diminish: "decrease", discontinue: "stop", elevated: "high",
  eliminate: "remove", employ: "use", employs: "uses", endeavour: "try",
  endeavor: "try", ensure: "make sure", ensures: "makes sure", entire: "all",
  equivalent: "equal", establish: "make", evident: "clear",
  excessive: "too much", exclusively: "only", exhibit: "show",
  facilitate: "help", feasible: "possible", frequently: "often",
  furthermore: "also", generate: "make", generates: "makes", hence: "so",
  however: "but", identical: "the same", illustrate: "show",
  immediately: "now", inasmuch: "because", indicate: "show",
  indicates: "shows", initial: "first", initiate: "start",
  initiates: "starts", inquire: "ask", insufficient: "too few",
  instruct: "tell", involve: "include", involves: "includes", likewise: "also",
  locate: "find", locates: "finds", magnitude: "size", maintain: "keep",
  maintains: "keeps", majority: "most", moreover: "also", nevertheless: "but",
  nonetheless: "but", notify: "tell", numerous: "many", obtain: "get",
  obtains: "gets", occur: "happen", occurs: "happens", occurred: "happened",
  optimum: "best", particular: "specific", portion: "part", possess: "have",
  possesses: "has", previous: "last", previously: "before", principal: "main",
  procure: "get", proximity: "distance", purchase: "buy", regarding: "about",
  remainder: "the rest", request: "ask", requisite: "necessary",
  retain: "keep", retains: "keeps", subsequent: "next", subsequently: "then",
  sufficient: "enough", terminate: "stop", terminates: "stops",
  thereafter: "then", thereby: "so", therefore: "so", thus: "so",
  transmit: "send", typically: "usually", ultimately: "at the end",
  utilise: "use", utilize: "use", utilises: "uses", utilizes: "uses",
  vary: "change", virtually: "almost", whilst: "while", wish: "want",
};

/**
 * Words and phrases that make text sound like a chat assistant. The user does
 * not want them. Most of them add no information.
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

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A word boundary on each side, so a real word such as delvertex does not
// match delve. A plain substring test cannot tell the two apart.
const CHAT_STYLE_PATTERNS = CHAT_STYLE.map((phrase) => ({
  phrase,
  re: new RegExp("\\b" + escapeRegExp(phrase) + "\\b"),
}));

/**
 * Words that end in -ing and that the checker accepts. STE rule 3.3 refuses
 * the -ing form of a verb. It accepts an -ing word that is a noun or a
 * technical name.
 */
const ALLOWED_ING = new Set([
  "string", "strings", "substring", "substrings", "thing", "things", "nothing", "something", "anything",
  "everything", "during", "setting", "settings", "heading", "headings",
  "padding", "encoding", "spacing", "ring", "spring", "wing", "king", "bring",
  "sing", "ping", "morning", "evening", "ceiling", "sibling", "siblings",
  "wiring", "binding", "bindings", "coupling", "bearing", "bounding",
  "dangling", "indexing", "drawing", "drawings", "turing", "floating",
  "casing", "spring", "timing", "wording",
]);

/**
 * Technical names that this project owns. STE rule 1.5 accepts a technical
 * name. The checker does not test these words against the word lists.
 */
const TECHNICAL_NAMES = new Set([
  "render", "renders", "rendered", "renderer", "reject", "rejects",
  "rejected", "commit", "commits", "committed", "stage", "stages", "staged",
  "derive", "derives", "derived", "evaluate", "evaluates", "evaluated",
  "mutation", "mutations", "mutate", "mutates", "slot", "slots", "formula",
  "formulas", "literal", "literals", "parse", "parses", "parsed", "parser",
  "lexer", "camera", "canvas", "topological", "acyclic", "cycle", "cycles",
  "graph", "node", "nodes", "edge", "edges", "primitive", "primitives",
  "polygon", "polyline", "vertex", "vertices", "centroid", "address",
  "addresses", "serialise", "serialize", "serialized", "journal",
  "transaction", "transactional", "schema", "schemas", "viewport", "zoom",
  "pan", "glyph", "glyphs", "kerning", "baseline", "token", "tokens",
  "operand", "operator", "operators", "precedence", "recursive", "recursion",
  "boolean", "integer", "float", "enum", "callback", "iterator", "immutable",
  "idempotent",
]);

/** Short capital words that are names, not loud emphasis. */
const ACRONYMS = new Set([
  "TS", "JS", "JSON", "DOM", "API", "ID", "IDS", "AST", "DAG", "CSS", "HTML",
  "URL", "UI", "CLI", "RGB", "OK", "NOT", "MUST", "NEVER", "ONLY", "ALL",
  "PNG", "JPG", "SVG", "GPU", "CPU", "IO", "UTF", "MD", "STE", "ASD", "XY",
  "SPEC", "CAD", "DXF", "IPC", "RAM", "URI", "CSV", "TODO", "ASCII", "NaN",
  "STATUS", "GPL", "MIT", "DFS", "REF", "AND", "OR", "IF", "SUM", "MIN",
  "MAX", "AVG", "ABS", "POW", "LEN", "PI", "SIN", "COS", "TAN", "DEG", "RAD",
  "TRUE", "FALSE", "NULL", "TYPE", "DIV0", "PARSE", "SCRIPT", "MEASURE",
]);

/** Words that show the passive voice when a form of "be" comes before them. */
const PAST_PARTICIPLES = [
  "\\w+ed", "written", "given", "taken", "made", "done", "kept", "held",
  "read", "built", "set", "put", "sent", "shown", "drawn", "known", "seen",
  "found", "left", "meant", "split", "hit", "cut", "lost", "thrown", "torn",
  "chosen", "driven", "grown", "spent", "told", "brought", "bound", "sold",
];

/* ------------------------------------------------------------------ */
/* Prose extraction                                                    */
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
      out.push({ line: start, text });
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

/** Reads the prose out of an HTML file: its comments, and its CSS comments. */
function extractHtml(source) {
  const out = [];
  const lines = source.split(String.fromCharCode(10));
  let depth = 0;
  for (let k = 0; k < lines.length; k++) {
    const raw = lines[k];
    const opens = (raw.match(/<!--|[/][*]/g) || []).length;
    const closes = (raw.match(/-->|[*][/]/g) || []).length;
    if (depth > 0 || opens > 0) out.push({ line: k + 1, text: raw });
    depth += opens - closes;
    if (depth < 0) depth = 0;
  }
  return out;
}

/** Reads the prose out of a Markdown file. Code blocks and tables go away. */
function extractMarkdown(source) {
  const out = [];
  const lines = source.split("\n");
  let inFence = false;
  for (let k = 0; k < lines.length; k++) {
    const raw = lines[k];
    if (/^\s*```/.test(raw)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (/^\s{4,}\S/.test(raw)) continue;
    if (/^ *[|][ -:|]*$/.test(raw)) continue;
    if (/^ *[|]/.test(raw)) {
      out.push({ line: k + 1, text: raw.replace(/[|]/g, ". ") });
      continue;
    }
    out.push({ line: k + 1, text: raw });
  }
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
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z"(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */

const PASSIVE = new RegExp(
  "\\b(is|are|was|were|be|been|being)\\s+(?:" +
    PAST_PARTICIPLES.join("|") +
    ")\\b",
  "i"
);

const CONTRACTIONS =
  /\b(?:can't|won't|don't|doesn't|didn't|isn't|aren't|wasn't|weren't|hasn't|haven't|hadn't|shouldn't|wouldn't|couldn't|it's|that's|there's|here's|what's|let's|we're|they're|you're|i'm|we've|they've|you've|we'll|they'll|you'll|it'll)\b/i;

const VAGUE_MODALS = /\b(shall|should|could|would|might|may|ought)\b/i;

const STOP_WORDS = new Set([
  "the", "a", "an", "of", "to", "in", "on", "for", "is", "are", "and", "but",
  "that", "this", "it", "as", "at", "by", "from", "with", "not", "no", "must",
  "can", "does", "do", "has", "have", "if", "when", "so", "or", "its", "each",
  "every", "all", "one", "two", "only", "never", "also", "then", "than", "up",
  "out", "off", "how", "why", "what", "which", "who", "you", "we", "they",
  "he", "she", "them", "their", "first", "next", "last", "same", "new", "old",
  "more", "most", "less", "any", "some", "both", "into", "over", "under",
  "again", "still", "just", "very", "own", "because", "while", "before",
  "after", "keeps", "keep", "gives", "give", "takes", "take", "make", "makes",
  "reads", "read", "writes", "write", "holds", "hold", "needs", "need",
  "wants", "want", "gets", "get", "puts", "put", "calls", "call", "shows",
  "show", "sets", "was", "were", "be", "been", "being", "will", "now", "here",
  "there", "where", "about", "back", "down", "such", "many", "much", "other",
  "another", "against", "between", "through", "during", "without", "within",
  "along", "across", "behind", "beyond", "plus", "per", "via",
  "zc", "zr", "zn", "rule", "rules", "form", "forms", "name", "names",
  "includes", "include", "uses", "holds", "hold", "means", "mean", "covers",
  "cover", "stays", "stay", "sits", "sit", "goes", "go", "comes", "come",
]);

/** Runs every rule against one sentence. Returns a list of fault records. */
function checkSentence(sentence, record) {
  const faults = [];
  const add = (rule, detail, fix) =>
    faults.push({ rule, detail, fix, ...record });

  const words = sentence.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  const isInstruction =
    /^(Do|Use|Read|Write|Keep|Make|Set|Put|Add|Remove|Call|Check|Give|Take|Start|Stop|Send|Open|Close|Find|Show|Move|Draw|Never|Always)\b/.test(
      sentence
    );
  const limit = isInstruction ? 20 : 25;
  if (words.length > limit) {
    add(
      "length",
      words.length + " words, limit " + limit,
      "Cut the sentence into two."
    );
  }

  const passive = sentence.match(PASSIVE);
  if (passive) {
    add("passive", passive[0], "Name the actor and use the active voice.");
  }

  for (const word of words) {
    const bare = word.toLowerCase().replace(/[^a-z-]/g, "");
    if (!bare || bare === "zc" || bare === "zr" || bare === "zn") continue;
    if (TECHNICAL_NAMES.has(bare)) continue;

    if (bare.endsWith("ing") && bare.length > 4 && !ALLOWED_ING.has(bare)) {
      add("ing-form", bare, "STE rule 3.3. Use a simple tense or a noun.");
    }
    if (NOT_APPROVED[bare]) {
      add("word", bare, 'Not approved. Use "' + NOT_APPROVED[bare] + '".');
    }
  }

  const contraction = sentence.match(CONTRACTIONS);
  if (contraction) add("contraction", contraction[0], "Write the words in full.");

  const modal = sentence.match(VAGUE_MODALS);
  if (modal) {
    add(
      "modal",
      modal[0],
      'STE rule 3.5. Use "must" for a duty and "can" for an ability.'
    );
  }

  if (/;/.test(sentence)) {
    add("semicolon", ";", "The user refuses semicolons. Use two sentences.");
  }
  if (/[—–]/.test(sentence)) {
    add("dash", "long dash", "Use a full stop or a comma.");
  }
  if (/\band\/or\b|\betc\.|\be\.g\.|\bi\.e\./i.test(sentence)) {
    add("abbreviation", "short form", "Write the words in full.");
  }
  if (/\s&\s/.test(sentence)) add("ampersand", "&", 'Write "and".');
  if (/[a-z]\/[a-z]/i.test(sentence)) {
    add("slash", "/", "STE rule 4.4. Write the words in full.");
  }

  const low = sentence.toLowerCase();
  for (const { phrase, re } of CHAT_STYLE_PATTERNS) {
    if (re.test(low)) {
      add("chat-style", phrase, "Delete it or say the fact plainly.");
    }
  }

  const shout = sentence.match(/\b[A-Z]{3,}\b/g) || [];
  for (const s of shout) {
    if (!ACRONYMS.has(s)) {
      add("shouting", s, "Do not use capitals for emphasis.");
    }
  }

  const cluster = sentence.toLowerCase().match(/(?<![a-z])[a-z]+(?: +[a-z]+){3,}(?![a-z])/);
  if (cluster) {
    const parts = cluster[0].trim().split(/\s+/);
    if (parts.every((p) => !STOP_WORDS.has(p))) {
      add(
        "noun-cluster",
        cluster[0].trim(),
        "STE rule 2.1. Use no more than three nouns together."
      );
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

  for (const block of blocks) {
    const clean = stripCode(block.text);
    for (const sentence of sentences(clean)) {
      if (sentence.split(/\s+/).length < 3) continue;
      faults.push(
        ...checkSentence(sentence, { file: path, line: block.line, sentence })
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
  total += faults.length;
  if (faults.length > 0) byFile[path] = faults.length;
  for (const fault of faults) {
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
