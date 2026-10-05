"use client";

import { useEffect, useMemo, useState } from "react";
import type { RenderAssets } from "./renderer";
import { loadVisualImages } from "./visualArt";
import type { VisualId } from "./visuals";

const FALLBACK_FONTS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif';

function fontFamily(variable: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return value ? `${value}, ${FALLBACK_FONTS}` : FALLBACK_FONTS;
}

export type CanvasFonts = {
  /** CSS font-family lists for headings and body text. */
  heading: string;
  body: string;
  /** Bumped when a font finishes loading, so text is laid out again. */
  version: number;
};

/**
 * Makes the app's web fonts usable on canvas. `text` is the text that will
 * be drawn; passing it makes the browser fetch the font files for the
 * scripts actually used (for example Devanagari).
 */
export function useCanvasFonts(text: string): CanvasFonts | null {
  const [families, setFamilies] = useState<{ heading: string; body: string } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    // Read once the page has painted, when the font variables are certainly set.
    const frame = requestAnimationFrame(() =>
      setFamilies({ heading: fontFamily("--font-heading"), body: fontFamily("--font-body") }),
    );
    const onFontsLoaded = () => setVersion((v) => v + 1);
    document.fonts?.addEventListener("loadingdone", onFontsLoaded);
    return () => {
      cancelAnimationFrame(frame);
      document.fonts?.removeEventListener("loadingdone", onFontsLoaded);
    };
  }, []);

  useEffect(() => {
    if (!families || !document.fonts) return;
    const sample = text || "Aa";
    void Promise.allSettled([
      document.fonts.load(`700 48px ${families.heading}`, sample),
      document.fonts.load(`500 48px ${families.body}`, sample),
      document.fonts.load(`600 48px ${families.body}`, sample),
    ]);
  }, [families, text]);

  return useMemo(() => (families ? { ...families, version } : null), [families, version]);
}

/** Everything the explainer renderer needs: the illustrations and the fonts. */
export function useRenderAssets(text: string): RenderAssets | null {
  const fonts = useCanvasFonts(text);
  const [images, setImages] = useState<Map<VisualId, HTMLImageElement> | null>(null);

  useEffect(() => {
    let active = true;
    loadVisualImages().then((loaded) => {
      if (active) setImages(loaded);
    });
    return () => {
      active = false;
    };
  }, []);

  return useMemo(
    () =>
      images && fonts
        ? { images, headingFont: fonts.heading, bodyFont: fonts.body, version: fonts.version }
        : null,
    [images, fonts],
  );
}
