import type { Metadata } from "next";
import { Playfair_Display, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-head",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-data",
});

export const metadata: Metadata = {
  title: "Fractals MVP",
  description: "Secure. Structured. Timeless. CodexOne / Fractals V4.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`antialiased bg-vellum text-obsidian ${playfair.variable} ${jetbrains.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
