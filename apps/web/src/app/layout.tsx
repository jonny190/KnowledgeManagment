import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Knowledge Management",
  description: "Web-based knowledge management platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
