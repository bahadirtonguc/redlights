import type { Metadata } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { Providers } from "@/store/Providers";

export const metadata: Metadata = {
  title: "Hamburg — Green Route",
  description:
    "A live map of Hamburg's traffic lights, with a route drawn through the ones currently green.",
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
