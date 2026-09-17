/**
 * The direct text editor displays the same emphasis as the canvas while
 * storing the existing text syntax. Embedded expressions are atomic spans,
 * which preserves their source when surrounding text is edited or formatted.
 * DOM construction uses text nodes so document content cannot inject markup.
 */
import { parseMarkdownLite } from "./markdown.ts";
import { mathMarkup } from "./math.ts";

export type RichTextElement = HTMLDivElement & { value: string; select(): void };

function emphasis(source: string, marker: string): string {
  return source.split("\n").map(line => line.replace(/^(\s*)(.*?\S)(\s*)$/, (_match, before: string, text: string, after: string) => `${before}${marker}${text}${marker}${after}`)).join("\n");
}

function sourceOf(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/[\\*`]/g, "\\$&");
  if (!(node instanceof HTMLElement)) return "";
  if (node.dataset.source !== undefined) return node.dataset.source;
  if (node.tagName === "BR") return "\n";
  let inside = Array.from(node.childNodes).map(sourceOf).join("");
  if (node.dataset.list) inside = "- " + inside.replace(/^\u2022 /, "");
  if (["B", "STRONG"].includes(node.tagName) || Number(node.style.fontWeight) >= 600 || node.style.fontWeight === "bold") return emphasis(inside, "**");
  if (["I", "EM"].includes(node.tagName) || node.style.fontStyle === "italic") return emphasis(inside, "*");
  if (node.tagName === "CODE") return "`" + node.textContent + "`";
  if (/^H[1-3]$/.test(node.tagName)) return `${"#".repeat(Number(node.tagName[1]))} ${inside}\n`;
  if (["DIV", "P"].includes(node.tagName)) return `${inside.endsWith("\n") ? inside : inside + "\n"}`;
  return inside;
}

export function richTextSource(element: HTMLElement): string {
  return Array.from(element.childNodes).map(sourceOf).join("").replace(/\n$/, "");
}

export function variableChip(source: string, resolved?: string): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "variable-chip";
  chip.contentEditable = "false";
  chip.dataset.source = source;
  chip.textContent = resolved ?? source.replace(/^\{=\s*|\s*\}$/g, "");
  chip.title = `${source} · double-click to edit`;
  chip.setAttribute("role", "button");
  chip.tabIndex = 0;
  const edit = () => {
    const field = document.createElement("input");
    field.className = "variable-chip-input";
    field.value = source.replace(/^\{=\s*|\s*\}$/g, "");
    field.setAttribute("aria-label", "Embedded formula");
    chip.replaceWith(field);
    field.focus(); field.select();
    let finished = false;
    const close = (cancel: boolean) => {
      if (finished) return;
      finished = true;
      const replacement = variableChip(cancel ? source : `{= ${field.value} }`);
      const parent = field.parentElement;
      field.replaceWith(replacement);
      parent?.closest<HTMLElement>("[contenteditable=true]")?.focus();
    };
    field.addEventListener("keydown", event => { event.stopPropagation(); if (["Enter", "Escape"].includes(event.key)) { event.preventDefault(); close(event.key === "Escape"); } });
    field.addEventListener("blur", () => close(false));
  };
  chip.addEventListener("dblclick", edit);
  chip.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); edit(); } });
  return chip;
}

export function writeRichText(element: HTMLElement, source: string): void {
  element.replaceChildren();
  const expressions: string[] = [];
  const protectedSource = source.replace(/\{=[^{}]*\}/g, value => { expressions.push(value); return `\uE000${expressions.length - 1}\uE001`; });
  for (const line of parseMarkdownLite(protectedSource)) {
    const block = document.createElement(line.kind === "heading" ? `h${line.level}` : "div");
    if (!line.runs.length) block.append(document.createElement("br"));
    for (const run of line.runs) {
      let parent: HTMLElement = block;
      if (run.bold && line.kind !== "heading") { const bold = document.createElement("b"); parent.append(bold); parent = bold; }
      if (run.italic) { const italic = document.createElement("i"); parent.append(italic); parent = italic; }
      if (run.code) { const code = document.createElement("code"); parent.append(code); parent = code; }
      if (run.latex !== undefined) {
        const math = document.createElement("span"); math.contentEditable = "false";
        math.dataset.source = line.kind === "math" ? `{$$ ${run.latex} }` : `{$ ${run.latex} }`;
        math.innerHTML = mathMarkup(run.latex); parent.append(math); continue;
      }
      const parts = run.text.split(/(\uE000\d+\uE001)/g);
      for (const part of parts) {
        const match = /^\uE000(\d+)\uE001$/.exec(part);
        parent.append(match ? variableChip(expressions[Number(match[1])]!) : document.createTextNode(part));
      }
    }
    if (line.kind === "list") block.dataset.list = "true";
    element.append(block);
  }
}

export function createRichText(source: string): RichTextElement {
  const element = document.createElement("div") as RichTextElement;
  element.className = "text-editor rich-text-editor";
  element.contentEditable = "true";
  element.setAttribute("role", "textbox");
  element.setAttribute("aria-label", "Edit text");
  element.setAttribute("aria-multiline", "true");
  Object.defineProperty(element, "value", { get: () => richTextSource(element), set: (value: string) => writeRichText(element, value) });
  element.select = () => { const range = document.createRange(); range.selectNodeContents(element); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); };
  element.value = source;
  element.addEventListener("paste", event => {
    event.preventDefault();
    document.execCommand("insertText", false, event.clipboardData?.getData("text/plain") ?? "");
  });
  return element;
}

export function insertVariable(element: HTMLElement, expression: string): void {
  element.focus();
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.commonAncestorContainer)) return;
  range.deleteContents();
  const chip = variableChip(`{= ${expression} }`);
  range.insertNode(chip);
  range.setStartAfter(chip); range.collapse(true);
  selection.removeAllRanges(); selection.addRange(range);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}
