import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "agent-wire-docling",
  description: "Folder in → folder out. Taste test for heterogeneous document corpora.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
