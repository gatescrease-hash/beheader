/**
 * svg-context.ts
 *
 * The second drawing backend: a recorder that takes the calls the renderer
 * makes on a Canvas2D context and writes them out as an SVG picture. The
 * renderer runs unchanged against it, so the vector picture carries the same
 * geometry, text layout and measurement as the canvas on screen.
 *
 * Each point is transformed by the current matrix at the moment the call adds
 * it, the way Canvas2D transforms a path, so the paths it writes are already in
 * picture coordinates, with no transform of their own. A line width, a
 * dash, a font size and a radius scale with the matrix in force when the path
 * is filled, stroked or written. The renderer only scales, translates and
 * mirrors, so a circle stays a circle, and an arc keeps one radius.
 *
 * A canvas draws what it is told and forgets the call. This backend writes an
 * element for each fill, stroke, rectangle, run of text and image, in the order
 * the calls come, so later marks sit on top of earlier ones as they do on a
 * canvas. A clip becomes a clipPath that the elements drawn before the matching
 * restore refer to. clearRect writes nothing, because a picture starts empty.
 *
 * Text measurement comes in through the constructor, because a width needs a
 * font engine and this file has none. An image comes in as the bitmap the
 * renderer holds, and the constructor's resolver names the URL it came from.
 *
 * Render-layer code: it builds a string, and touches no DOM.
 */
import type { DrawingContext } from "./drawing.ts";

/** The width of a run of text in a CSS font, in the units of that font. */
export type SvgTextMeasurer = (font: string, text: string) => number;

/** The URL an image the renderer draws came from, or undefined to leave it out. */
export type SvgImageResolver = (image: CanvasImageSource) => string | undefined;

/** a, b, c, d, e, f, as Canvas2D and SVG both write a 2D affine matrix. */
type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

interface DrawingState {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  globalAlpha: number;
  dash: readonly number[];
  matrix: Matrix;
  clip: string | undefined;
}

/** A number as the picture writes it: three decimals at most, and no negative zero. */
function n(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A colour the picture can write. A gradient or a pattern has no place here, so it draws nothing. */
function paint(style: string | CanvasGradient | CanvasPattern): string {
  return typeof style === "string" ? escapeXml(style) : "none";
}

const TEXT_ANCHORS: Readonly<Record<CanvasTextAlign, string>> = { left: "start", start: "start", center: "middle", right: "end", end: "end" };

const BASELINES: Readonly<Record<CanvasTextBaseline, string>> = {
  alphabetic: "alphabetic",
  top: "text-before-edge",
  hanging: "hanging",
  middle: "central",
  ideographic: "ideographic",
  bottom: "text-after-edge",
};

/**
 * The parts of a CSS font shorthand the picture writes: style, weight, size
 * and family. The renderer writes its fonts in that order, such as
 * "italic 600 16px sans-serif", so the size is the token that ends in px and
 * the family is everything after it.
 */
export function parseFont(font: string): { readonly style: string; readonly weight: string; readonly size: number; readonly family: string } {
  const tokens = font.trim().split(/\s+/);
  const sizeAt = tokens.findIndex((token) => /^[\d.]+px(\/.*)?$/.test(token));
  if (sizeAt === -1) {
    return { style: "normal", weight: "normal", size: 10, family: "sans-serif" };
  }
  const before = tokens.slice(0, sizeAt);
  const style = before.find((token) => token === "italic" || token === "oblique") ?? "normal";
  const weight = before.find((token) => token === "bold" || token === "bolder" || token === "lighter" || /^\d{3}$/.test(token)) ?? "normal";
  return { style, weight, size: Number.parseFloat(tokens[sizeAt]!), family: tokens.slice(sizeAt + 1).join(" ") || "sans-serif" };
}

export class SvgContext implements DrawingContext {
  private state: DrawingState = {
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    dash: [],
    matrix: IDENTITY,
    clip: undefined,
  };
  private readonly stack: DrawingState[] = [];
  private path: string[] = [];
  private hasCurrentPoint = false;
  /** The current point in picture coordinates, so an arc that starts there adds no line of zero length. */
  private currentPoint: readonly [number, number] = [0, 0];
  private readonly defs: string[] = [];
  private readonly body: string[] = [];
  private clipCount = 0;

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly measure: SvgTextMeasurer,
    private readonly imageHref: SvgImageResolver = () => undefined,
  ) {}

  get fillStyle(): string | CanvasGradient | CanvasPattern { return this.state.fillStyle; }
  set fillStyle(value: string | CanvasGradient | CanvasPattern) { this.state.fillStyle = value; }
  get strokeStyle(): string | CanvasGradient | CanvasPattern { return this.state.strokeStyle; }
  set strokeStyle(value: string | CanvasGradient | CanvasPattern) { this.state.strokeStyle = value; }
  get lineWidth(): number { return this.state.lineWidth; }
  set lineWidth(value: number) { if (Number.isFinite(value) && value > 0) this.state.lineWidth = value; }
  get font(): string { return this.state.font; }
  set font(value: string) { this.state.font = value; }
  get textAlign(): CanvasTextAlign { return this.state.textAlign; }
  set textAlign(value: CanvasTextAlign) { this.state.textAlign = value; }
  get textBaseline(): CanvasTextBaseline { return this.state.textBaseline; }
  set textBaseline(value: CanvasTextBaseline) { this.state.textBaseline = value; }
  get globalAlpha(): number { return this.state.globalAlpha; }
  set globalAlpha(value: number) { if (Number.isFinite(value) && value >= 0 && value <= 1) this.state.globalAlpha = value; }

  save(): void {
    this.stack.push({ ...this.state });
  }

  restore(): void {
    const previous = this.stack.pop();
    if (previous !== undefined) this.state = previous;
  }

  setTransform(a?: number | DOMMatrix2DInit, b = 0, c = 0, d = 1, e = 0, f = 0): void {
    if (typeof a === "number") {
      this.state.matrix = [a, b, c, d, e, f];
      return;
    }
    this.state.matrix = a === undefined ? IDENTITY : [a.a ?? 1, a.b ?? 0, a.c ?? 0, a.d ?? 1, a.e ?? 0, a.f ?? 0];
  }

  setLineDash(segments: number[]): void {
    this.state.dash = segments.filter((segment) => Number.isFinite(segment) && segment >= 0);
  }

  measureText(text: string): TextMetrics {
    return { width: this.measure(this.state.font, text) } as TextMetrics;
  }

  beginPath(): void {
    this.path = [];
    this.hasCurrentPoint = false;
  }

  moveTo(x: number, y: number): void {
    const [px, py] = this.point(x, y);
    this.path.push(`M${n(px)} ${n(py)}`);
    this.hasCurrentPoint = true;
    this.currentPoint = [px, py];
  }

  lineTo(x: number, y: number): void {
    const [px, py] = this.point(x, y);
    this.path.push(`${this.hasCurrentPoint ? "L" : "M"}${n(px)} ${n(py)}`);
    this.hasCurrentPoint = true;
    this.currentPoint = [px, py];
  }

  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void {
    if (!this.hasCurrentPoint) this.moveTo(cp1x, cp1y);
    const [ax, ay] = this.point(cp1x, cp1y);
    const [bx, by] = this.point(cp2x, cp2y);
    const [px, py] = this.point(x, y);
    this.path.push(`C${n(ax)} ${n(ay)} ${n(bx)} ${n(by)} ${n(px)} ${n(py)}`);
    this.currentPoint = [px, py];
  }

  closePath(): void {
    if (this.hasCurrentPoint) this.path.push("Z");
  }

  /**
   * An arc as Canvas2D defines it: from the start angle to the end angle about
   * the centre, clockwise on screen unless the last argument says otherwise,
   * joined to the current point by a straight line. A sweep of a whole turn or
   * more draws the whole circle, which SVG writes as two half arcs because one
   * arc cannot end where it starts.
   */
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise = false): void {
    if (!(radius >= 0)) return;
    const turn = Math.PI * 2;
    const start = { x: x + radius * Math.cos(startAngle), y: y + radius * Math.sin(startAngle) };
    const [startX, startY] = this.point(start.x, start.y);
    const atStart = this.hasCurrentPoint && n(startX) === n(this.currentPoint[0]) && n(startY) === n(this.currentPoint[1]);
    if (!this.hasCurrentPoint) this.moveTo(start.x, start.y);
    else if (!atStart) this.lineTo(start.x, start.y);
    const full = counterclockwise ? startAngle - endAngle >= turn : endAngle - startAngle >= turn;
    const r = n(radius * this.scale());
    const mirrored = this.determinant() < 0;
    const sweepFlag = (counterclockwise !== mirrored) ? 0 : 1;
    if (full) {
      const half = startAngle + (counterclockwise ? -Math.PI : Math.PI);
      const [hx, hy] = this.point(x + radius * Math.cos(half), y + radius * Math.sin(half));
      const [sx, sy] = this.point(start.x, start.y);
      this.path.push(`A${r} ${r} 0 0 ${sweepFlag} ${n(hx)} ${n(hy)}`, `A${r} ${r} 0 0 ${sweepFlag} ${n(sx)} ${n(sy)}`);
      this.currentPoint = [sx, sy];
      return;
    }
    let sweep = counterclockwise ? startAngle - endAngle : endAngle - startAngle;
    sweep = ((sweep % turn) + turn) % turn;
    const end = { x: x + radius * Math.cos(endAngle), y: y + radius * Math.sin(endAngle) };
    const [ex, ey] = this.point(end.x, end.y);
    this.path.push(`A${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} ${sweepFlag} ${n(ex)} ${n(ey)}`);
    this.currentPoint = [ex, ey];
  }

  rect(x: number, y: number, width: number, height: number): void {
    this.moveTo(x, y);
    this.lineTo(x + width, y);
    this.lineTo(x + width, y + height);
    this.lineTo(x, y + height);
    this.closePath();
  }

  /** A rectangle with rounded corners, given one radius for all four or a list from the top left round. */
  roundRect(x: number, y: number, width: number, height: number, radii?: number | DOMPointInit | (number | DOMPointInit)[]): void {
    const given = (Array.isArray(radii) ? radii : [radii ?? 0]).map((radius) => (typeof radius === "number" ? radius : radius.x ?? 0));
    // One to four radii expand to the four corners the way CSS border-radius does.
    const [a = 0, b = a, c = a, d = b] = given;
    const limit = Math.min(Math.abs(width), Math.abs(height)) / 2;
    const [tl, tr, br, bl] = [a, b, c, d].map((radius) => Math.max(0, Math.min(radius, limit))) as [number, number, number, number];
    this.moveTo(x + tl, y);
    this.lineTo(x + width - tr, y);
    if (tr > 0) this.arc(x + width - tr, y + tr, tr, -Math.PI / 2, 0);
    this.lineTo(x + width, y + height - br);
    if (br > 0) this.arc(x + width - br, y + height - br, br, 0, Math.PI / 2);
    this.lineTo(x + bl, y + height);
    if (bl > 0) this.arc(x + bl, y + height - bl, bl, Math.PI / 2, Math.PI);
    this.lineTo(x, y + tl);
    if (tl > 0) this.arc(x + tl, y + tl, tl, Math.PI, Math.PI * 1.5);
    this.closePath();
  }

  fill(): void {
    if (this.path.length === 0) return;
    this.body.push(`<path d="${this.path.join(" ")}" fill="${paint(this.state.fillStyle)}" stroke="none"${this.common()}/>`);
  }

  stroke(): void {
    if (this.path.length === 0) return;
    this.body.push(`<path d="${this.path.join(" ")}" fill="none"${this.strokeAttributes()}${this.common()}/>`);
  }

  /** Narrows what later calls draw to the current path, until the matching restore. */
  clip(): void {
    const id = `clip${(this.clipCount += 1)}`;
    const inner = this.state.clip === undefined ? "" : ` clip-path="url(#${this.state.clip})"`;
    this.defs.push(`<clipPath id="${id}"><path d="${this.path.join(" ")}"${inner}/></clipPath>`);
    this.state.clip = id;
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.body.push(`<path d="${this.rectPath(x, y, width, height)}" fill="${paint(this.state.fillStyle)}" stroke="none"${this.common()}/>`);
  }

  strokeRect(x: number, y: number, width: number, height: number): void {
    this.body.push(`<path d="${this.rectPath(x, y, width, height)}" fill="none"${this.strokeAttributes()}${this.common()}/>`);
  }

  clearRect(): void {
    // A picture starts empty, so there is nothing to clear.
  }

  fillText(text: string, x: number, y: number): void {
    if (text === "") return;
    const font = parseFont(this.state.font);
    const [px, py] = this.point(x, y);
    const size = font.size * this.scale();
    const attributes = [
      `x="${n(px)}"`,
      `y="${n(py)}"`,
      `font-family="${escapeXml(font.family)}"`,
      `font-size="${n(size)}"`,
      font.weight === "normal" ? "" : `font-weight="${font.weight}"`,
      font.style === "normal" ? "" : `font-style="${font.style}"`,
      `text-anchor="${TEXT_ANCHORS[this.state.textAlign]}"`,
      `dominant-baseline="${BASELINES[this.state.textBaseline]}"`,
      `fill="${paint(this.state.fillStyle)}"`,
    ].filter((attribute) => attribute !== "").join(" ");
    this.body.push(`<text ${attributes} xml:space="preserve"${this.common()}>${escapeXml(text)}</text>`);
  }

  drawImage(image: CanvasImageSource, ...args: number[]): void {
    const href = this.imageHref(image);
    if (href === undefined) return;
    const [dx = 0, dy = 0, dw, dh] = args.length >= 8 ? args.slice(4) : args;
    const width = dw ?? ("width" in image ? Number(image.width) : 0);
    const height = dh ?? ("height" in image ? Number(image.height) : 0);
    const [px, py] = this.point(dx, dy);
    const scale = this.scale();
    this.body.push(`<image href="${escapeXml(href)}" x="${n(px)}" y="${n(py)}" width="${n(width * scale)}" height="${n(height * scale)}" preserveAspectRatio="none"${this.common()}/>`);
  }

  /** The picture so far, as a whole SVG document, on a white ground, or on none when the ground is null. */
  toString(background: string | null = "#ffffff"): string {
    const ground = background === null ? "" : `<rect width="${n(this.width)}" height="${n(this.height)}" fill="${escapeXml(background)}"/>`;
    const defs = this.defs.length === 0 ? "" : `<defs>${this.defs.join("")}</defs>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(this.width)}" height="${n(this.height)}" viewBox="0 0 ${n(this.width)} ${n(this.height)}">${defs}${ground}${this.body.join("")}</svg>`;
  }

  /** Appends markup the renderer cannot make, such as notation, on top of what is drawn so far. */
  append(markup: string): void {
    this.body.push(markup);
  }

  private point(x: number, y: number): [number, number] {
    const [a, b, c, d, e, f] = this.state.matrix;
    return [a * x + c * y + e, b * x + d * y + f];
  }

  private determinant(): number {
    const [a, b, c, d] = this.state.matrix;
    return a * d - b * c;
  }

  /** How much the current matrix scales a length, which is the same in every direction for the matrices the renderer sets. */
  private scale(): number {
    return Math.sqrt(Math.abs(this.determinant()));
  }

  private rectPath(x: number, y: number, width: number, height: number): string {
    const corners = [this.point(x, y), this.point(x + width, y), this.point(x + width, y + height), this.point(x, y + height)];
    return `M${corners.map(([px, py]) => `${n(px)} ${n(py)}`).join(" L")} Z`;
  }

  private strokeAttributes(): string {
    const scale = this.scale();
    const dash = this.state.dash.length === 0 ? "" : ` stroke-dasharray="${this.state.dash.map((segment) => n(segment * scale)).join(" ")}"`;
    return ` stroke="${paint(this.state.strokeStyle)}" stroke-width="${n(this.state.lineWidth * scale)}"${dash}`;
  }

  private common(): string {
    const opacity = this.state.globalAlpha === 1 ? "" : ` opacity="${n(this.state.globalAlpha)}"`;
    const clip = this.state.clip === undefined ? "" : ` clip-path="url(#${this.state.clip})"`;
    return opacity + clip;
  }
}
