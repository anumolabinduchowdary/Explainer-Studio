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

/**
 * Loads what the canvas needs: the illustrations as images and the web fonts.
 * `text` is the storyboard's text; passing it makes the browser fetch the
 * font files for the scripts actually used (for example Devanagari).
 */
export function useRenderAssets(text: string): RenderAssets | null {
  const [images, setImages] = useState<Map<VisualId, HTMLImageElement> | null>(null);
  const [version, setVersion] = useState(0);
  const [fonts, setFonts] = useState<{ heading: string; body: string } | null>(null);

  useEffect(() => {
    let active = true;
    loadVisualImages().then((loaded) => {
      if (!active) return;
      setImages(loaded);
      setFonts({ heading: fontFamily("--font-heading"), body: fontFamily("--font-body") });
    });
    // Text drawn before a font arrives is laid out again once it has loaded.
    const onFontsLoaded = () => setVersion((v) => v + 1);
    document.fonts?.addEventListener("loadingdone", onFontsLoaded);
    return () => {
      active = false;
      document.fonts?.removeEventListener("loadingdone", onFontsLoaded);
    };
  }, []);

  useEffect(() => {
    if (!fonts || !document.fonts) return;
    const sample = text || "Aa";
    void Promise.allSettled([
      document.fonts.load(`700 48px ${fonts.heading}`, sample),
      document.fonts.load(`500 48px ${fonts.body}`, sample),
      document.fonts.load(`600 48px ${fonts.body}`, sample),
    ]);
  }, [fonts, text]);

  return useMemo(
    () =>
      images && fonts
        ? { images, headingFont: fonts.heading, bodyFont: fonts.body, version }
        : null,
    [images, fonts, version],
  );
}
