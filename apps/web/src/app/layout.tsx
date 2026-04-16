import "./globals.css";
import "@/styles/theme.css";
import type { ReactNode } from "react";
import type { Viewport } from "next";
import { Providers } from "./providers";

export const metadata = {
  title: "Knowledge Management",
  description: "Web-based knowledge management platform",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('km:theme');if(!t||t==='system')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <Providers>
          <header className="border-b p-2 flex gap-3 text-sm">
            <a href="/workspaces" className="underline">Workspaces</a>
            <a href="/api/auth/signout" className="underline">Sign out</a>
          </header>
          {children}
        </Providers>
      </body>
    </html>
  );
}
