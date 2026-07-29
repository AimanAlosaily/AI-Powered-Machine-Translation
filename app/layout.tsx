import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000/";
const socialImage = `${siteUrl.replace(/\/$/, "")}/og.png`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Verta — Private offline translation",
  description:
    "Translate documents and images on your device with no API key, account, or file upload.",
  applicationName: "Verta",
  manifest: "manifest.webmanifest",
  openGraph: {
    title: "Verta — Meaning in. Nothing out.",
    description:
      "Private on-device translation for documents and images. No API key or upload.",
    type: "website",
    images: [{ url: socialImage, width: 1200, height: 630, alt: "Verta" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Verta — Meaning in. Nothing out.",
    description:
      "Private on-device translation for documents and images. No API key or upload.",
    images: [socialImage],
  },
};

export const viewport: Viewport = {
  themeColor: "#17201b",
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
