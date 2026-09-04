/**
 * images.test.ts — Tests for `images.ts` (§5.7's decoded-bitmap cache).
 *
 * No jsdom (D-001/PROCESS_BRIEF §4: never add a runtime dependency). Every test
 * passes `createImageBitmapCache` a fake element factory and fires
 * `onload`/`onerror` by hand — the same injected-fake posture `renderer.test.ts`
 * takes for `CanvasRenderingContext2D` and the engine takes for `TextMeasurer`.
 */
import { describe, expect, it } from "vitest";
import { createImageBitmapCache } from "./images.ts";

/** The mutable half of an `HTMLImageElement` this file actually drives: the src it was given, the two handlers, and the size a decode reports. */
interface FakeImageElement {
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}

/** A factory plus the elements it handed out, so a test can both fire a decode and count how many were started. */
function fakeElements(): { readonly create: () => HTMLImageElement; readonly made: readonly FakeImageElement[] } {
  const made: FakeImageElement[] = [];
  const create = (): HTMLImageElement => {
    const element: FakeImageElement = { src: "", naturalWidth: 40, naturalHeight: 20, onload: null, onerror: null };
    made.push(element);
    // The fake implements exactly the members `images.ts` touches; a real
    // element has many more it never does (file header's reasoning).
    return element as unknown as HTMLImageElement;
  };
  return { create, made };
}

const SOURCE = "data:image/png;base64,AAAA";

describe("createImageBitmapCache — asking for a picture", () => {
  it("returns undefined for an empty source and starts no decode at all, because an image with no picture chosen is the ordinary created state", () => {
    const { create, made } = fakeElements();
    const cache = createImageBitmapCache(() => undefined, create);
    expect(cache.bitmapFor("")).toBeUndefined();
    expect(made).toHaveLength(0);
  });

  it("returns undefined on the first ask and starts exactly one decode, since a decode cannot finish inside the paint that requested it", () => {
    const { create, made } = fakeElements();
    const cache = createImageBitmapCache(() => undefined, create);
    expect(cache.bitmapFor(SOURCE)).toBeUndefined();
    expect(made).toHaveLength(1);
    expect(made[0]?.src).toBe(SOURCE);
  });

  it("starts ONE decode per distinct source however many times it is asked, because every paint asks again", () => {
    const { create, made } = fakeElements();
    const cache = createImageBitmapCache(() => undefined, create);
    for (let paint = 0; paint < 50; paint += 1) {
      cache.bitmapFor(SOURCE);
    }
    expect(made).toHaveLength(1);
  });

  it("decodes two different sources separately, keyed by the source string", () => {
    const { create, made } = fakeElements();
    const cache = createImageBitmapCache(() => undefined, create);
    cache.bitmapFor(SOURCE);
    cache.bitmapFor("data:image/png;base64,BBBB");
    expect(made).toHaveLength(2);
  });
});

describe("createImageBitmapCache — a decode that lands", () => {
  it("returns the decoded picture with the natural size §5.7's aspect-ratio clause needs, once onload has fired", () => {
    const { create, made } = fakeElements();
    const cache = createImageBitmapCache(() => undefined, create);
    cache.bitmapFor(SOURCE);
    const element = made[0];
    element?.onload?.();
    expect(cache.bitmapFor(SOURCE)).toEqual({ image: element, naturalWidth: 40, naturalHeight: 20 });
  });

  it("calls onDecoded exactly once, which is what repaints a frame that was drawn empty", () => {
    const { create, made } = fakeElements();
    let repaints = 0;
    const cache = createImageBitmapCache(() => {
      repaints += 1;
    }, create);
    cache.bitmapFor(SOURCE);
    made[0]?.onload?.();
    expect(repaints).toBe(1);
    cache.bitmapFor(SOURCE);
    expect(repaints).toBe(1);
  });

  it("never calls onDecoded from bitmapFor itself, so a paint can never re-enter itself through the cache", () => {
    const { create } = fakeElements();
    let repaints = 0;
    const cache = createImageBitmapCache(() => {
      repaints += 1;
    }, create);
    cache.bitmapFor(SOURCE);
    expect(repaints).toBe(0);
  });
});

describe("createImageBitmapCache — a decode that fails", () => {
  it("keeps returning undefined for a source that failed, and never retries it", () => {
    const { create, made } = fakeElements();
    const cache = createImageBitmapCache(() => undefined, create);
    cache.bitmapFor(SOURCE);
    made[0]?.onerror?.();
    expect(cache.bitmapFor(SOURCE)).toBeUndefined();
    expect(made).toHaveLength(1);
  });

  it("does not repaint for a failed decode, because nothing on screen would change", () => {
    const { create, made } = fakeElements();
    let repaints = 0;
    const cache = createImageBitmapCache(() => {
      repaints += 1;
    }, create);
    cache.bitmapFor(SOURCE);
    made[0]?.onerror?.();
    expect(repaints).toBe(0);
  });

  it("treats a decode reporting a zero natural size as a failure, since no ratio can be taken from it", () => {
    const { create, made } = fakeElements();
    const cache = createImageBitmapCache(() => undefined, create);
    cache.bitmapFor(SOURCE);
    const element = made[0];
    if (element !== undefined) {
      element.naturalWidth = 0;
    }
    element?.onload?.();
    expect(cache.bitmapFor(SOURCE)).toBeUndefined();
  });

  it("treats a decode reporting a non-finite natural size as a failure too", () => {
    const { create, made } = fakeElements();
    const cache = createImageBitmapCache(() => undefined, create);
    cache.bitmapFor(SOURCE);
    const element = made[0];
    if (element !== undefined) {
      element.naturalHeight = Number.NaN;
    }
    element?.onload?.();
    expect(cache.bitmapFor(SOURCE)).toBeUndefined();
  });
});
