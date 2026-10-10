import { access, cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageWasmDir = path.join(root, "node_modules", "@wllama", "wllama", "src", "wasm");
const publicWasmDir = path.join(root, "public", "vendor", "wllama", "src", "wasm");
const outputDir = path.join(root, "public", "vendor", "wllama");

try {
  await access(path.join(packageWasmDir, "wllama.wasm"));
} catch {
  throw new Error("Pinned Wllama WASM asset missing at " + path.join(packageWasmDir, "wllama.wasm") + ". Verify @wllama/wllama@3.8.1 is installed and its published package contains src/wasm.");
}

await mkdir(publicWasmDir, { recursive: true });
await cp(packageWasmDir, publicWasmDir, { recursive: true, force: true });

await build({
  configFile: false,
  root,
  publicDir: false,
  logLevel: "info",
  build: {
    outDir: outputDir,
    emptyOutDir: false,
    lib: {
      entry: path.join(root, "src", "local-ai-runtime-entry.js"),
      formats: ["es"],
      fileName: () => "runtime.js"
    },
    rollupOptions: {
      output: {
        entryFileNames: "runtime.js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});

console.log("Local AI runtime bundle and pinned WASM assets are ready in public/vendor/wllama.");
