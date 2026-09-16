import type { Metadata } from "next";
import { Geist, Geist_Mono, Lora } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Body face for the desktop notebook editor. A warm, slightly calligraphic
// serif is what makes the page read as a journal rather than a text box; it is
// scoped to the editor surface, so the rest of the app stays on Geist.
const lora = Lora({
  variable: "--font-notebook",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Brain Portal",
  description: "Think clearly. Connect everything.",
  applicationName: "Brain Portal",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Brain Portal",
  },
  formatDetection: {
    telephone: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${lora.variable} antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
