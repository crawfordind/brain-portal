import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Brain Portal",
    short_name: "Brain",
    description: "Think clearly. Connect everything.",
    start_url: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#0d9488",
    orientation: "portrait-primary",
    scope: "/",
    icons: [
      {
        src: "/icons/icon-192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/icon-192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
    categories: ["productivity", "utilities"],

    // Web Share Target — puts Brain Portal in the OS share sheet (Android
    // Chrome, and any browser implementing the spec) so a link or a block of
    // text can be sent straight here instead of copied, pasted, and lost.
    //
    // GET rather than POST on purpose: a GET target is a plain navigation to a
    // normal page, so it needs no service-worker interception and no
    // POST-redirect dance. The trade-off is that files can't ride along — file
    // sharing would need a POST target and is not wired up.
    share_target: {
      action: "/share",
      method: "GET",
      enctype: "application/x-www-form-urlencoded",
      params: {
        title: "title",
        text: "text",
        url: "url",
      },
    },

    shortcuts: [
      {
        name: "Save something",
        short_name: "Save",
        description: "Capture a link, a note, or a task",
        url: "/share",
      },
    ],
  };
}
