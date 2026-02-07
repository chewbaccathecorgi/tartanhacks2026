import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false, // Disable for WebSocket compatibility in dev
  // When using ngrok, set NEXT_PUBLIC_APP_URL to your ngrok URL (e.g. https://xxx.ngrok-free.dev)
  // so script and asset URLs work when the page is opened via ngrok.
  ...(process.env.NEXT_PUBLIC_APP_URL
    ? { assetPrefix: process.env.NEXT_PUBLIC_APP_URL }
    : {}),
};

export default nextConfig;
