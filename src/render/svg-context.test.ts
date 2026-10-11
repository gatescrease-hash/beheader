/**
 * svg-context.test.ts
 *
 * These tests cover the SVG backend call by call against the picture it
 * writes: paths transformed as Canvas2D transforms them, line widths and
 * dashes that scale with the matrix, arcs in both directions and whole
 * circles, rounded corners, text with its alignment, baseline and font,
 * clipping, opacity, saved state and images.
 */
import { describe, expect, it } from "vitest";
import { parseFont, SvgContext } from "./svg-context.ts";

const measure = (font: string, text: string): number => text.length * parseFont(font).size * 0.5;

function picture(draw: (context: SvgContext) => void): string {
  const context = new SvgContext(100, 50, measure);
  draw(context);
  return context.toString(null);
}

describe("SvgContext", () => {
  it("writes a stroked path in picture coordinates, with the matrix applied at each point", () => {
    const svg = picture((context) => {
      context.setTransform(2, 0, 0, 2, 10, 20);
      context.strokeStyle = "#a85e45";
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(5, 0);
      context.lineTo(5, 5);
      context.closePath();
      context.stroke();
    });
    expect(svg).toContain(`<path d="M10 20 L20 20 L20 30 Z" fill="none" stroke="#a85e45" stroke-width="3"/>`);
    expect(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50">`)).toBe(true);
  });

  it("fills and strokes the same path as two elements, in the order of the calls", () => {
    const svg = picture((context) => {
      context.fillStyle = "rgba(1, 2, 3, 0.5)";
      context.rect(0, 0, 4, 4);
      context.fill();
      context.stroke();
    });
    expect(svg.indexOf(`fill="rgba(1, 2, 3, 0.5)" stroke="none"`)).toBeLessThan(svg.indexOf(`fill="none" stroke="#000000"`));
  });

  it("writes a whole circle as two half arcs, and a part of one with the flags Canvas2D implies", () => {
    const circle = picture((context) => {
      context.beginPath();
      context.arc(50, 25, 10, 0, Math.PI * 2);
      context.fill();
    });
    expect(circle).toContain(`d="M60 25 A10 10 0 0 1 40 25 A10 10 0 0 1 60 25"`);
    const big = picture((context) => {
      context.beginPath();
      context.arc(0, 0, 10, 0, Math.PI * 1.5);
      context.stroke();
    });
    expect(big).toContain(`A10 10 0 1 1 0 -10`);
    const back = picture((context) => {
      context.beginPath();
      context.arc(0, 0, 10, 0, Math.PI / 2, true);
      context.stroke();
    });
    expect(back).toContain(`A10 10 0 1 0 0 10`);
  });

  it("joins an arc to the current point with a line, and scales its radius with the matrix", () => {
    const svg = picture((context) => {
      context.setTransform(2, 0, 0, 2, 0, 0);
      context.beginPath();
      context.moveTo(0, 0);
      context.arc(10, 0, 5, Math.PI, 0);
      context.stroke();
    });
    expect(svg).toContain(`d="M0 0 L10 0 A10 10 0 0 1 30 0"`);
  });

  it("rounds only the corners a list of radii names, the way CSS expands it", () => {
    const svg = picture((context) => {
      context.beginPath();
      context.roundRect(0, 0, 20, 10, [4, 4, 0, 0]);
      context.fill();
    });
    expect(svg.match(/A4 4/g)).toHaveLength(2);
    expect(svg).toContain("M4 0 L16 0 A4 4 0 0 1 20 4 L20 10 L0 10 L0 4 A4 4 0 0 1 4 0 Z");
  });

  it("writes text with its anchor, baseline, weight, style and a size scaled by the matrix", () => {
    const svg = picture((context) => {
      context.setTransform(2, 0, 0, 2, 0, 0);
      context.font = "italic 600 10px Georgia, serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = "#1a1a1a";
      context.fillText("a < b & c", 10, 5);
    });
    expect(svg).toContain(`<text x="20" y="10" font-family="Georgia, serif" font-size="20" font-weight="600" font-style="italic" text-anchor="middle" dominant-baseline="central" fill="#1a1a1a" xml:space="preserve">a &lt; b &amp; c</text>`);
  });

  it("measures text through the measurer it was given, in the current font", () => {
    const context = new SvgContext(10, 10, measure);
    context.font = "16px sans-serif";
    expect(context.measureText("abcd").width).toBe(32);
  });

  it("scales a dash with the matrix, writes opacity, and gives back the saved state on restore", () => {
    const svg = picture((context) => {
      context.save();
      context.setTransform(3, 0, 0, 3, 0, 0);
      context.setLineDash([2, 1]);
      context.globalAlpha = 0.25;
      context.strokeRect(0, 0, 1, 1);
      context.restore();
      context.strokeRect(0, 0, 1, 1);
    });
    expect(svg).toContain(`stroke-dasharray="6 3" opacity="0.25"/>`);
    expect(svg).toContain(`<path d="M0 0 L1 0 L1 1 L0 1 Z" fill="none" stroke="#000000" stroke-width="1"/>`);
  });

  it("clips what is drawn after a clip to its path, until the matching restore", () => {
    const svg = picture((context) => {
      context.save();
      context.beginPath();
      context.rect(0, 0, 5, 5);
      context.clip();
      context.fillText("inside", 1, 1);
      context.restore();
      context.fillText("outside", 1, 1);
    });
    expect(svg).toContain(`<defs><clipPath id="clip1"><path d="M0 0 L5 0 L5 5 L0 5 Z"/></clipPath></defs>`);
    expect(svg).toMatch(/clip-path="url\(#clip1\)">inside<\/text>/);
    expect(svg).toMatch(/xml:space="preserve">outside<\/text>/);
  });

  it("draws an image through the URL the resolver names, and leaves out one it cannot name", () => {
    const known = { width: 4, height: 2 } as unknown as CanvasImageSource;
    const unknown = { width: 4, height: 2 } as unknown as CanvasImageSource;
    const context = new SvgContext(10, 10, measure, (image) => (image === known ? "data:image/png;base64,AA==" : undefined));
    context.drawImage(known, 1, 2, 8, 4);
    context.drawImage(unknown, 1, 2, 8, 4);
    const svg = context.toString(null);
    expect(svg).toContain(`<image href="data:image/png;base64,AA==" x="1" y="2" width="8" height="4" preserveAspectRatio="none"/>`);
    expect(svg.match(/<image/g)).toHaveLength(1);
  });

  it("starts on a white ground unless told to leave it clear, and writes nothing for clearRect", () => {
    const context = new SvgContext(10, 10, measure);
    context.clearRect();
    expect(context.toString()).toContain(`<rect width="10" height="10" fill="#ffffff"/>`);
    expect(context.toString(null)).toBe(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"></svg>`);
  });
});

describe("parseFont", () => {
  it("reads style, weight, size and family from the shorthand the renderer writes", () => {
    expect(parseFont("16px sans-serif")).toEqual({ style: "normal", weight: "normal", size: 16, family: "sans-serif" });
    expect(parseFont("bold italic 12.5px Inter, Arial")).toEqual({ style: "italic", weight: "bold", size: 12.5, family: "Inter, Arial" });
    expect(parseFont("nonsense")).toEqual({ style: "normal", weight: "normal", size: 10, family: "sans-serif" });
  });
});
