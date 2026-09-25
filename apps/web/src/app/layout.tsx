import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { NavBar } from "@/components/NavBar";
import { Footer } from "@/components/Footer";
import { themeBootScript } from "@/lib/theme";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const title = "Ledger · Get paid before your client pays";
const description =
  "A Bitcoin-backed business account for freelancers on Mezo. Turn client-accepted invoices into on-chain receivables, get an instant MUSD advance, and settle everything in MUSD.";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#00050B" },
    { media: "(prefers-color-scheme: light)", color: "#F4F7FB" },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title,
  description,
  icons: {
    icon: [
      { url: "/brand/mark.svg", type: "image/svg+xml" },
      { url: "/brand/favicon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/brand/favicon-512.png", sizes: "512x512" }],
  },
  openGraph: {
    title,
    description,
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630, alt: "Ledger" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/brand/og-image.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="flex min-h-screen flex-col bg-paper font-sans text-ink antialiased">
        <Providers>
          <NavBar />
          <main className="flex-1">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
