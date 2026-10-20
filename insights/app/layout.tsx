import type { Metadata, Viewport } from "next";
import { Baloo_2, Nunito } from "next/font/google";
import "./globals.css";

// The same friendly rounded fonts as Explainer Studio.
const heading = Baloo_2({ variable: "--font-heading", subsets: ["latin"], weight: ["600", "700"], display: "swap" });
const body = Nunito({ variable: "--font-body", subsets: ["latin"], weight: ["400", "600", "700"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Video Insights", template: "%s · Video Insights" },
  description: "Watches the videos Explainer Studio posts to YouTube and explains why each one is, or isn't, going viral.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fffaf3" },
    { media: "(prefers-color-scheme: dark)", color: "#15120f" },
  ],
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
