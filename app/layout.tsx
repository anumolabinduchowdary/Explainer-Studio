import type { Metadata, Viewport } from "next";
import { Baloo_2, Nunito } from "next/font/google";
import { APP_NAME } from "@/lib/config";
import "./globals.css";

// Friendly rounded fonts. They are also used for the text inside the video.
const heading = Baloo_2({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["600", "700"],
  display: "swap",
});

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
    <html lang="en" className={`${heading.variable} ${body.variable} h-full antialiased`}>
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
