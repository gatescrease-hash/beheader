/**
 * images.ts
 *
 * A cache of decoded bitmaps, keyed by the data URL the document stores.
 *
 * Decoding is asynchronous, but a paint cannot wait. The cache returns
 * whatever it already holds and starts a decode for anything it does not, so
 * the first frame after an image arrives draws nothing and the next one draws
 * the picture.
 *
 * Render-layer code: it reads engine state and calls mutations, and crosses
 * that line for nothing else. Nothing in the engine imports this file, so a
 * GPU renderer can replace the whole layer later.
 */
export interface DecodedBitmap {
  readonly image: CanvasImageSource;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
}

export interface ImageBitmaps {

  bitmapFor(source: string): DecodedBitmap | undefined;
}

interface CacheEntry {
  status: "loading" | "ready" | "failed";
  bitmap: DecodedBitmap | undefined;
}

export function decodeBitmap(
  source: string,
  onDecoded: (bitmap: DecodedBitmap | undefined) => void,
  createElement: () => HTMLImageElement = () => new Image(),
): void {
  if (source === "") {
    onDecoded(undefined);
    return;
  }
  const element = createElement();
  element.onload = (): void => {
    if (!Number.isFinite(element.naturalWidth) || !Number.isFinite(element.naturalHeight) || element.naturalWidth <= 0 || element.naturalHeight <= 0) {
      onDecoded(undefined);
      return;
    }
    onDecoded({ image: element, naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight });
  };
  element.onerror = (): void => {
    onDecoded(undefined);
  };
  element.src = source;
}

export function createImageBitmapCache(onDecoded: () => void, createElement: () => HTMLImageElement = () => new Image()): ImageBitmaps {
  const entries = new Map<string, CacheEntry>();

  return {
    bitmapFor(source: string): DecodedBitmap | undefined {
      if (source === "") {
        return undefined;
      }
      const existing = entries.get(source);
      if (existing !== undefined) {
        return existing.status === "ready" ? existing.bitmap : undefined;
      }

      const entry: CacheEntry = { status: "loading", bitmap: undefined };
      entries.set(source, entry);
      decodeBitmap(
        source,
        (bitmap) => {
          if (bitmap === undefined) {
            entry.status = "failed";
            return;
          }
          entry.status = "ready";
          entry.bitmap = bitmap;
          onDecoded();
        },
        createElement,
      );
      return undefined;
    },
  };
}
