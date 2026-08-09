import { defineNitroConfig } from "nitro/config";

export default defineNitroConfig({
  serverDir: "./server",
  compatibilityDate: "2026-07-28",
  preset: "cloudflare_module",
  cloudflare: {
    deployConfig: false,
    nodeCompat: true,
  },
});
