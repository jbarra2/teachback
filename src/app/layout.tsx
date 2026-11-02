import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TopNav } from "@/components/top-nav";
import { cn, focusRing } from "@/components/ui";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TeachBack",
  description:
    "Explain concepts in your own words and get feedback grounded in your lecture notes.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <a
          href="#main"
          className={cn(
            "sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded-md focus:bg-background focus:px-3 focus:py-2",
            focusRing,
          )}
        >
          Skip to content
        </a>
        <TopNav />
        <main
          id="main"
          className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8"
        >
          {children}
        </main>
      </body>
    </html>
  );
}
