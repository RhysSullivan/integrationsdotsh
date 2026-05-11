import { defineConfig } from "astro/config";
import react from "@astrojs/react";

export default defineConfig({
  site: "https://integrations.sh",
  integrations: [react()],
  build: {
    format: "directory",
  },
});
