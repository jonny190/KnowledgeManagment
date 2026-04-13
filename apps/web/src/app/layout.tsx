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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
