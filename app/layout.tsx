import { IBM_Plex_Mono, IBM_Plex_Sans_KR } from "next/font/google";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "../styles/tokens.css";
import "../styles/globals.css";

// EPIC 1-2: TRD picks IBM Plex Sans KR / IBM Plex Mono, fallback to
// 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif. next/font/google
// downloads and self-hosts these at build time (needs network access
// during `next build`; see the task report for details).
const ibmPlexSansKR = IBM_Plex_Sans_KR({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans-kr",
  fallback: ["Apple SD Gothic Neo", "Malgun Gothic", "sans-serif"],
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono-ibm",
  fallback: ["Apple SD Gothic Neo", "Malgun Gothic", "monospace"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "회의록 자동 작성",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html
      lang="ko"
      className={`${ibmPlexSansKR.variable} ${ibmPlexMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
