import { access, cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageWasmDir = path.join(root, "node_modules", "@wllama", "wllama", "src", "wasm");
const compatWasmDir = path.join(root, "node_modules", "@wllama", "wllama-compat", "wasm");
const publicWasmDir = path.join(root, "public", "vendor", "wllama", "src", "wasm");
const publicCompatDir = path.join(root, "public", "vendor", "wllama-compat", "wasm");
const outputDir = path.join(root, "public", "vendor", "wllama");

for (const [asset, label] of [
  [path.join(packageWasmDir, "wllama.wasm"), "Wllama WASM"],
  [path.join(compatWasmDir, "wllama.wasm"), "Safari-compat WASM"],
  [path.join(compatWasmDir, "wllama.js"), "Safari-compat worker"]
]) {
  try {
    await access(asset);
  } catch {
    throw new Error(label + " asset missing at " + asset + ". Verify the pinned Wllama packages are installed.");
  }
}

await mkdir(publicWasmDir, { recursive: true });
await mkdir(publicCompatDir, { recursive: true });
await cp(packageWasmDir, publicWasmDir, { recursive: true, force: true });
await cp(compatWasmDir, publicCompatDir, { recursive: true, force: true });

await build({
  configFile: false,
  root,
  base: "/vendor/wllama/",
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

console.log("Pinned Wllama runtime, WASM, and Safari-compat assets are ready in public/vendor.");
