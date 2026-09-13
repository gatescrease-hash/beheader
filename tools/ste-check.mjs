#!/usr/bin/env node
/**
 * ste-check.mjs - a prose checker for this repository.
 *
 * Every comment, header and document here follows ASD-STE100 Simplified
 * Technical English. This script reads the prose out of a file and reports
 * each line that breaks a rule. Code is not prose, so the script removes all
 * code before it starts.
 *
 * The script takes one or more paths. The --all flag reads the whole
 * repository, --quiet prints the summary alone, and --advice prints the
 * notes that carry no fault.
 *
 *   node tools/ste-check.mjs <path> [more paths]
 *   node tools/ste-check.mjs --all
 *   node tools/ste-check.mjs --all --quiet --advice
 *
 * It gives exit code 1 when it finds a fault, and exit code 0 when the prose
 * is clean.
 *
 * The script checks the rules that a machine can check. Those are sentence
 * length, active voice, verb form, word choice, punctuation, noun clusters
 * and the register of a comment. A person still checks the rest.
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

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A word boundary on each side, so a real word such as delvertex does not
// match the shorter one. A plain substring test cannot tell the two apart.
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
  "casing", "spring", "timing", "wording", "meaning", "ending", "endings",
  "warning", "warnings", "reading", "readings", "opening", "closing",
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

const PASSIVE = new RegExp(
  "\\b(is|are|was|were|be|been|being)\\s+(?:" +
    PAST_PARTICIPLES.join("|") +
    ")\\b",
  "i"
);

const CONTRACTIONS =
  /\b(?:can't|won't|don't|doesn't|didn't|isn't|aren't|wasn't|weren't|hasn't|haven't|hadn't|shouldn't|wouldn't|couldn't|it's|that's|there's|here's|what's|let's|we're|they're|you're|i'm|we've|they've|you've|we'll|they'll|you'll|it'll)\b/i;

const VAGUE_MODALS = /\b(shall|should|could|would|might|may|ought)\b/i;

/**
 * Verbs that open an order. A comment describes the code, so a sentence that
 * opens with one of these speaks to a reader instead of about the code.
 */
const IMPERATIVE_OPEN =
  /^(Do|Use|Read|Write|Keep|Make|Set|Put|Add|Remove|Call|Check|Give|Take|Start|Stop|Send|Open|Close|Find|Show|Move|Draw|Never|Always|Prefer|Avoid|Treat|Ask|Update|Run|Pick|Cut|Leave|Change|Import|Note|Consider|Ensure|Remember|Let|Think|Try|Look|Hold|Wire|Load|Skip|Reuse|Follow|Trust|Assume)\b/;

/** Words that hand a duty to a reader rather than state a fact. */
const OBLIGATION = /\b(must|do not|don't|you|your)\b/i;

/** A colon label that stands in place of a sentence, such as "Layer: engine". */
const LABEL_OPEN = /^(?:z[crn] )?[A-Z][a-z]+ *:/;

/**
 * Verbs that carry a sentence without an -s or -ed ending. A whitelist of
 * every verb is impossible to keep. The fragment test asks a narrower
 * question: does any word here look like a verb?
 */
const BARE_VERB =
  /\b(is|are|was|were|be|has|have|had|does|do|did|can|cannot|will|go|come|hold|keep|give|take|make|read|write|need|want|get|put|call|show|set|draw|run|add|mean|use|cover|stay|sit|turn|name|carry|become|exist|belong|depend|return|work|live|fail|pass|move|change|pick|refuse|allow|leave|know|own|declare|build|parse|split|join|reach|apply|start|stop|open|close|find|serve|treat|prefer|avoid|end|begin|cost|prove|follow|throw|drive|paint|feed|beat|accept|send|break|count|measure)\b/i;

/**
 * Words that open a reason. Rule 2 asks a sentence that names a limit to give
 * the reason beside it.
 */
const REASON = /\b(so|because|which|since|to keep|to make|to let|for)\b/i;

/** Words that name a limit on the code. */
const LIMIT = /\b(only|no|not|never|without|alone|apart from|nothing)\b/i;

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
  "zc", "zr", "zn", "zq", "rule", "rules", "form", "forms", "name", "names",
  "includes", "include", "uses", "holds", "hold", "means", "mean", "covers",
  "cover", "stays", "stay", "sits", "sit", "goes", "go", "comes", "come",
]);

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
function checkSentence(sentence, record, isCode) {
  const faults = [];
  const add = (rule, detail, fix) =>
    faults.push({ rule, detail, fix, ...record });
  const warn = (rule, detail, fix) =>
    faults.push({ rule, detail, fix, warn: true, ...record });

  const words = sentence.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  if (words.length > 25) {
    add("length", words.length + " words, limit 25", "Cut the sentence into two.");
  }

  if (isCode) {
    const duty = sentence.match(OBLIGATION);
    if (duty) {
      add(
        "obligation",
        duty[0],
        "State the fact about the code, and give the reason for it."
      );
    }
    if (IMPERATIVE_OPEN.test(sentence)) {
      add(
        "imperative",
        words[0],
        "A comment describes the code. Name the actor and say what it does."
      );
    }
    if (LABEL_OPEN.test(sentence)) {
      add("fragment", words[0], "Write a sentence with a subject and a verb.");
    } else if (words.length <= 5 && !looksLikeSentence(sentence)) {
      add("fragment", sentence, "Write a sentence with a subject and a verb.");
    }
    if (LIMIT.test(sentence) && !REASON.test(sentence)) {
      warn(
        "no-reason",
        "a limit with no reason",
        'Say why the limit holds, with "so" or "because".'
      );
    }
  }

  const passive = sentence.match(PASSIVE);
  if (passive) {
    add("passive", passive[0], "Name the actor and use the active voice.");
  }

  for (const word of words) {
    const bare = word.toLowerCase().replace(/[^a-z-]/g, "");
    if (!bare || ["zc", "zr", "zn", "zq"].includes(bare)) continue;
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
      'STE rule 3.5. Say what the code does, and use "can" for an ability.'
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
  // A document states requirements and gives instructions, so the register
  // rules fight it. They apply to the comments in source alone.
  const isCode = ext !== ".md";

  for (const block of blocks) {
    const clean = stripCode(block.text);
    for (const sentence of sentences(clean)) {
      if (sentence.split(/\s+/).length < 3) continue;
      faults.push(
        ...checkSentence(
          sentence,
          { file: path, line: block.line, sentence },
          isCode
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

// A warning marks prose that a machine cannot judge with confidence. It
// prints, but it does not set the exit code, so a false positive cannot block
// a commit.
let total = 0;
let advice = 0;
const byRule = {};
const byFile = {};
const warnings = [];
for (const path of targets) {
  let faults;
  try {
    faults = checkFile(path);
  } catch (error) {
    console.error(path + ": cannot read. " + error.message);
    continue;
  }
  for (const fault of faults) {
    if (fault.warn) {
      advice++;
      warnings.push(fault);
      continue;
    }
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

if (advice > 0 && args.includes("--advice")) {
  for (const fault of warnings) {
    console.log(fault.file + ":" + fault.line + "  [" + fault.rule + "] " + fault.detail);
    console.log("    " + fault.sentence.slice(0, 160));
    console.log("    -> " + fault.fix);
  }
}

console.log("\n" + total + " fault(s) in " + targets.length + " file(s).");
if (advice > 0) {
  console.log(advice + " advisory note(s). Run with --advice to read them.");
}
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
