import process from "node:process"
import type { VitePWAOptions } from "vite-plugin-pwa"
import { VitePWA } from "vite-plugin-pwa"

const pwaOption: Partial<VitePWAOptions> = {
  includeAssets: ["shipping-hot-icon.svg"],
  filename: "swx.js",
  manifest: {
    name: "Shipping HOT",
    short_name: "Shipping HOT",
    description: "本地航运态势与热点信号工作台",
    theme_color: "#F14D42",
    icons: [
      {
        src: "shipping-hot-icon.svg",
        sizes: "192x192",
        type: "image/svg+xml",
      },
      {
        src: "shipping-hot-icon.svg",
        sizes: "512x512",
        type: "image/svg+xml",
      },
      {
        src: "shipping-hot-icon.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "shipping-hot-icon.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  },
  workbox: {
    navigateFallbackDenylist: [/^\/api/],
  },
  devOptions: {
    enabled: process.env.SW_DEV === "true",
    type: "module",
    navigateFallback: "index.html",
  },
}

export default function pwa() {
  return VitePWA(pwaOption)
}
