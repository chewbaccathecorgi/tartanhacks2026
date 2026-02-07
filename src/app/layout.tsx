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
      <head>
        {/* Run before other scripts so fetch/XHR send ngrok-skip-browser-warning (avoids ChunkLoadError when ngrok serves interstitial) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var o=typeof window!=='undefined'&&window.location?window.location.origin:'';function addHeader(opts){if(!opts)return;opts.headers=opts.headers||{};if(typeof opts.headers.append==='function'){try{opts.headers.append('ngrok-skip-browser-warning','true');}catch(e){}}else if(typeof opts.headers==='object'){opts.headers['ngrok-skip-browser-warning']='true';}}function isSameOrigin(url){if(!url||!o)return false;if(url.indexOf(o)===0)return true;if(url.charAt(0)==='/')return true;return false;}var f=typeof fetch!=='undefined'&&fetch;if(f){window.fetch=function(u,opts){var url=typeof u==='string'?u:(u&&u.url);if(isSameOrigin(url)){addHeader(opts);}return f.apply(this,arguments);};}var X=typeof XMLHttpRequest!=='undefined'&&XMLHttpRequest;if(X){var open=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url){if(isSameOrigin(url)){this.setRequestHeader('ngrok-skip-browser-warning','true');}return open.apply(this,arguments);};}})();`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
