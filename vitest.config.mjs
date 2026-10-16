import { defineConfig } from "vitest/config";
import codspeedPlugin from "@codspeed/vitest-plugin";

// Benchmark-only config: keeps the React/Vite app config untouched.
export default defineConfig({
  plugins: [codspeedPlugin()],
  test: {
    include: [],
    benchmark: {
      include: ["bench/**/*.bench.mjs"]
    }
  }
});
