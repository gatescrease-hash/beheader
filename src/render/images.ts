/**
 * images.ts — The decoded-bitmap cache: one decode per distinct data URL, plus
 * the repaint that follows a decode.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.7 ("Load via file picker, store as a data URL in
 * the document, draw at a position with width/height"). Binding here: Rule 1
 * (this cache may never live in `src/engine/`) and **D-142** (the `image` half
 * of Phase 6).
 * LAYER: render. Touches the DOM — an `HTMLImageElement` is how a browser turns
 * a data URL into pixels. Imports nothing at all. NEVER imported by engine/*.
 *
 * WHAT THIS IS
 *   `createImageBitmapCache(onDecoded)` returns an `ImageBitmaps`, whose one
 *   method answers "is there a decoded picture for this data URL yet?".
 *   `renderer.ts` asks once per `image` object per paint and draws that object's
 *   frame alone until the answer stops being `undefined`; `main.ts` hands in a
 *   repaint as `onDecoded`, which is what puts the picture on screen after the
 *   decode that the paint requesting it could not wait for.
 *
 *   **Why this is in `render/` and can never move.** An `HTMLImageElement` is a
 *   live DOM object and this file holds a `Map` of them — precisely what Rule 1
 *   and PROCESS_BRIEF §5.5 forbid `engine/` to hold. The document stores the
 *   data URL STRING and nothing else; every decoded byte lives here, outside the
 *   graph, and is rebuilt from the URL on the next load (0172-REVIEW §4).
 *
 * INVARIANTS UPHELD HERE
 *   - ONE decode per distinct source string, for the life of the cache: the map
 *     entry is written BEFORE the decode is started, so a paint asking sixty
 *     times a second still starts exactly one request.
 *   - Never throws. A source that fails to decode is remembered as failed and
 *     never retried, and a decode reporting a zero or non-finite natural size is
 *     treated as a failure rather than handed on as a degenerate box.
 *   - Writes no engine state and reads none (Rule 2) — this file never sees a
 *     `GraphObject`, only the string a slot happened to hold.
 *   - `onDecoded` is called only from a decode callback, NEVER from `bitmapFor`.
 *     A browser decodes asynchronously even for a data URL, so `bitmapFor`
 *     cannot re-enter the paint that called it.
 *
 * NOT DONE HERE
 *   - EVICTION. An entry is kept for the life of the page, even after every
 *     object referencing it has been deleted (Rule 5: performance and memory are
 *     explicitly non-goals; one entry per picture ever chosen).
 *   - Deciding WHERE or HOW BIG a picture is drawn — `renderer.ts`'s `drawImage`
 *     (inside the object's box) and `extent.ts` (the box itself). This file
 *     answers "is it decoded", and reports the natural size §5.7's aspect-ratio
 *     clause needs.
 *   - Reading a FILE. `main.ts`'s file picker turns a chosen file into a data URL
 *     and writes it to the object's `source` slot through `executeCommand`
 *     (Rule 2); this file only ever sees the string that write produced.
 */

/**
 * A picture the browser has finished decoding, with the natural size §5.7's
 * "preserve aspect ratio by default" needs.
 *
 * `image` is typed as `CanvasImageSource` rather than `HTMLImageElement` because
 * that is exactly what `renderer.ts` does with it — hands it to `drawImage` —
 * and narrowing the consumer's view to the one thing it may do keeps the DOM
 * surface this cache exposes as small as the seam allows.
 */
export interface DecodedBitmap {
  readonly image: CanvasImageSource;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
}

/**
 * The read side of the cache — the only shape `renderer.ts` knows about.
 *
 * Separate from the factory below so a test can supply a hand-written one
 * (`renderer.test.ts` does) without a DOM, the same injected-fake posture the
 * engine's `TextMeasurer` and this layer's fake `CanvasRenderingContext2D`
 * already take.
 */
export interface ImageBitmaps {
  /**
   * The decoded picture for `source`, or `undefined` when there is not one to
   * draw — an empty source, a decode still in flight, or one that failed.
   *
   * Starts the decode on the first ask for a source it has not seen. Never
   * throws, and never blocks: a caller that gets `undefined` draws without a
   * picture and is repainted when the decode lands.
   */
  bitmapFor(source: string): DecodedBitmap | undefined;
}

/** One cache entry. Mutable, and deliberately: this is live render state outside the graph, not the plain serializable document state §2 and §5.5 govern. */
interface CacheEntry {
  status: "loading" | "ready" | "failed";
  bitmap: DecodedBitmap | undefined;
}

/**
 * Builds the cache.
 *
 * `onDecoded` is called once per successful decode, after the entry is marked
 * ready — `main.ts` passes its `paint`, which is what makes a picture appear
 * without any polling: the paint that first asked for it drew the frame alone,
 * and this callback runs the next paint once there is something to put inside it.
 * A FAILED decode calls nothing, because nothing on screen would change.
 *
 * `createElement` exists so this file is testable with no DOM (D-001 keeps jsdom
 * out of this project): production uses `new Image()`, and a test passes a fake
 * element whose `onload`/`onerror` it fires by hand. It is the only DOM contact
 * in the file, and it is deliberately the last argument so no production caller
 * ever writes it.
 */
export function createImageBitmapCache(onDecoded: () => void, createElement: () => HTMLImageElement = () => new Image()): ImageBitmaps {
  const entries = new Map<string, CacheEntry>();

  return {
    bitmapFor(source: string): DecodedBitmap | undefined {
      if (source === "") {
        return undefined; // The "no picture yet" state a freshly created `image` object carries (`DEFAULT_IMAGE_SOURCE`).
      }
      const existing = entries.get(source);
      if (existing !== undefined) {
        return existing.status === "ready" ? existing.bitmap : undefined;
      }

      const element = createElement();
      // Written BEFORE `src` is assigned: a browser may fire `onload` for a data
      // URL as soon as the microtask queue drains, and an entry written after
      // the handler ran would overwrite a `ready` entry back to `loading`.
      const entry: CacheEntry = { status: "loading", bitmap: undefined };
      entries.set(source, entry);
      element.onload = (): void => {
        // A decode that reports no size is not usable — `drawImage` with a zero
        // natural dimension draws nothing and `fitBitmapIntoBox` cannot take a
        // ratio from it. Treated as a failure so it is never retried either.
        if (!Number.isFinite(element.naturalWidth) || !Number.isFinite(element.naturalHeight) || element.naturalWidth <= 0 || element.naturalHeight <= 0) {
          entry.status = "failed";
          return;
        }
        entry.status = "ready";
        entry.bitmap = { image: element, naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight };
        onDecoded();
      };
      element.onerror = (): void => {
        // A source that is not a picture — a text file chosen through the
        // picker, or a hand-typed `set image_1.source "nonsense"`. Remembered so
        // the next paint does not start the same doomed decode again.
        entry.status = "failed";
      };
      element.src = source;
      return undefined;
    },
  };
}
