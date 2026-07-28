import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/dyoor-world",
    name: "dYOOR World",
    short_name: "dYOOR",
    description: "The holder-exclusive D.Y.O.O.R community app on Monad.",
    start_url: "/dyoor-world",
    scope: "/dyoor-world",
    display: "standalone",
    background_color: "#050513",
    theme_color: "#080918",
    orientation: "any",
    categories: ["social", "entertainment"],
    icons: [
      {
        src: "/dyoor-world-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/dyoor-world-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/dyoor-world-icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
