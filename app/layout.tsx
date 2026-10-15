import type { Metadata, Viewport } from "next";
import {
  Baloo_2,
  Baloo_Bhai_2,
  Baloo_Bhaina_2,
  Baloo_Chettan_2,
  Baloo_Da_2,
  Baloo_Paaji_2,
  Baloo_Tamma_2,
  Baloo_Tammudu_2,
  Baloo_Thambi_2,
  Nunito,
} from "next/font/google";
import type { CSSProperties } from "react";
import { APP_NAME } from "@/lib/config";
import "./globals.css";

// Friendly rounded fonts. They are also used for the text inside the video.
const heading = Baloo_2({
  variable: "--font-heading",
  // Baloo 2 also covers Devanagari, for Hindi and Marathi.
  subsets: ["latin", "devanagari"],
  weight: ["600", "700"],
  display: "swap",
});

/*
 * The same rounded Baloo design for the other Indian scripts, so captions in
 * Telugu, Tamil and the rest look like the English ones, in the page and in
 * the finished video. Each is only downloaded when text in its script is shown.
 */
const telugu = Baloo_Tammudu_2({ subsets: ["telugu"], display: "swap", preload: false, adjustFontFallback: false });
const tamil = Baloo_Thambi_2({ subsets: ["tamil"], display: "swap", preload: false, adjustFontFallback: false });
const kannada = Baloo_Tamma_2({ subsets: ["kannada"], display: "swap", preload: false, adjustFontFallback: false });
const malayalam = Baloo_Chettan_2({ subsets: ["malayalam"], display: "swap", preload: false, adjustFontFallback: false });
const bengali = Baloo_Da_2({ subsets: ["bengali"], display: "swap", preload: false, adjustFontFallback: false });
const gujarati = Baloo_Bhai_2({ subsets: ["gujarati"], display: "swap", preload: false, adjustFontFallback: false });
const gurmukhi = Baloo_Paaji_2({ subsets: ["gurmukhi"], display: "swap", preload: false, adjustFontFallback: false });
const odia = Baloo_Bhaina_2({ subsets: ["oriya"], display: "swap", preload: false, adjustFontFallback: false });
const indianScripts = [telugu, tamil, kannada, malayalam, bengali, gujarati, gurmukhi, odia];
/** Baloo 2 first (Devanagari), then one family per script. Used after the main fonts. */
const indianFontStack = [heading.style.fontFamily, ...indianScripts.map((font) => font.style.fontFamily)].join(", ");

const body = Nunito({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: `${APP_NAME}: turn an idea into a short explainer video`,
  description:
    "Describe a short awareness or explainer video. Get a clear prompt, a scene-by-scene storyboard and an animated video you can download.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fffaf3",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${heading.variable} ${body.variable} h-full antialiased`}
      style={{ "--font-indic": indianFontStack } as CSSProperties}
    >
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:font-semibold focus:text-brand-strong focus:shadow"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
