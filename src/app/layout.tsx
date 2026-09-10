import type { Metadata } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { Providers } from "@/store/Providers";

export const metadata: Metadata = {
  title: "RED LIGHTS — Parallel Lives",
  description:
    "A live portrait of Hamburg, told through its red traffic lights.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full bg-black">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
