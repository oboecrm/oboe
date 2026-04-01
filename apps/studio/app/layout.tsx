import "./globals.css";

import type { Metadata } from "next";
import type React from "react";

export const metadata: Metadata = {
  description: "Official Next.js admin shell for OboeCRM",
  title: "OboeCRM Studio",
};

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{props.children}</body>
    </html>
  );
}
