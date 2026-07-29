import type { Metadata } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000/";
const socialImage = `${siteUrl.replace(/\/$/, "")}/og.png`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Verta — Context-aware AI translation",
  description:
    "Translate documents and images into 30+ languages while preserving context, terminology, tone, and structure.",
  openGraph: {
    title: "Verta — Translation that reads the room",
    description:
      "Context-aware translation for documents and images in 30+ languages.",
    type: "website",
    images: [{ url: socialImage, width: 1200, height: 630, alt: "Verta" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Verta — Translation that reads the room",
    description:
      "Context-aware translation for documents and images in 30+ languages.",
    images: [socialImage],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
