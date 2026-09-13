/**
 * images.ts
 *
 * The bitmap cache decodes a data URL once, and the result stays for later
 * paints.
 *
 * A decode is asynchronous. The cache hands back what it has and starts the
 * decode for what it lacks.
 *
 * The file belongs to the render layer. It reads engine state and calls
 * mutations, and it crosses that line for nothing else. The engine holds no
 * import of this file, which keeps the drawing code replaceable.
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
