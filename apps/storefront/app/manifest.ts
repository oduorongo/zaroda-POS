import type { MetadataRoute } from "next";

// Lets shoppers and riders install the marketplace to their home screen so it opens full screen like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Zaroda Marketplace",
    short_name: "Zaroda Shop",
    description: "Order from local shops, pay with M-Pesa, and track your delivery. Riders sign in here too.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a1633",
    theme_color: "#0a1633",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
    shortcuts: [
      { name: "Rider sign in", short_name: "Rider", url: "/rider" },
      { name: "My orders", short_name: "Orders", url: "/orders" },
    ],
  };
}
