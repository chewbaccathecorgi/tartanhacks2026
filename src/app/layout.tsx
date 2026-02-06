import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Facial Recognition Stream",
  description: "WebRTC stream receiver for facial recognition",
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
