import { readFile } from "node:fs/promises";
import path from "node:path";

function configured() {
  return Boolean(String(process.env.IPFS_API_URL || "").trim());
}

export function ipfsStatus() {
  return {
    configured: configured(),
    api: configured() ? String(process.env.IPFS_API_URL).trim() : null,
    mode: configured() ? "kubo-http-api" : "disabled"
  };
}

export async function publishToIpfs(filePath, filename = path.basename(filePath)) {
  if (!configured()) return { published: false, reason: "IPFS_API_URL not configured" };
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.append("file", new Blob([bytes]), filename);
  const base = String(process.env.IPFS_API_URL).replace(/\/$/, "");
  const url = base + "/api/v0/add?pin=true&cid-version=1";
  const response = await fetch(url, { method: "POST", body: form });
  const text = await response.text();
  if (!response.ok) throw new Error("IPFS add failed: HTTP " + response.status + " " + text.slice(0, 500));
  const lines = text.trim().split("\n").filter(Boolean);
  const record = JSON.parse(lines[lines.length - 1]);
  return {
    published: true,
    cid: String(record.Hash || record.Cid?.["/"] || ""),
    url: String(record.Hash || "").trim() ? "ipfs://" + String(record.Hash) : null,
    name: String(record.Name || filename),
    size: Number(record.Size || bytes.byteLength)
  };
}
