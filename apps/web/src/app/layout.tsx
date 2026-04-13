import "./globals.css";
import type { ReactNode } from "react";
import { Providers } from "./providers";

export const metadata = {
  title: "Knowledge Management",
  description: "Web-based knowledge management platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
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
