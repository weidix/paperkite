import adapter from "@sveltejs/adapter-static";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('@sveltejs/kit').Config} */
export default {
  kit: {
    adapter: adapter({
      pages: resolve(here, "../public"),
      assets: resolve(here, "../public"),
      fallback: "index.html"
    }),
    prerender: { entries: [] }
  }
};