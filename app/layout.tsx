import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "YapAI — Google GenAI Interactions (Gemini 3.1 Pro)",
  description: "Interactive AI Code Inspector powered by @google/genai SDK & Gemini 3.1 Pro Interactions API.",
  keywords: ["Google GenAI", "Gemini 3.1 Pro", "Race Condition Analyzer", "Next.js", "C++ Bug Finder"],
  authors: [{ name: "YapAI Studio" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-[#090d16] text-slate-100 selection:bg-blue-600 selection:text-white">
        {children}
      </body>
    </html>
  );
}
