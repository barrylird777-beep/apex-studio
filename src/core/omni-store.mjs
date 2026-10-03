import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export class OmniStore {
  constructor(root = process.env.APEX_OMNI_DATA_DIR ?? "./data/omni") {
    this.root = root;
    this.keyFile = path.join(root, ".omni.key");
    this.key = null;
  }
  async init() {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    this.key = await this.#loadKey();
    for (const name of ["search_runs","search_results","narrative_tracks","voice_assets"]) {
      const file = path.join(this.root, name + ".jsonl");
      try { await fs.access(file); } catch { await fs.writeFile(file, "", { encoding:"utf8", mode:0o600 }); }
    }
    return this;
  }
  async #loadKey() {
    const env=process.env.APEX_OMNI_STORE_KEY;
    if(env) return crypto.createHash("sha256").update(env).digest();
    try { return Buffer.from(await fs.readFile(this.keyFile,"base64")); }
    catch {
      const key=crypto.randomBytes(32);
      await fs.writeFile(this.keyFile,key.toString("base64"),{encoding:"utf8",mode:0o600});
      try { await fs.chmod(this.keyFile,0o600); } catch {}
      return key;
    }
  }
  #file(table) {
    if(!/^[a-z_]+$/.test(table)) throw new Error("Invalid table");
    return path.join(this.root, table + ".jsonl");
  }
  #seal(value) {
    const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv("aes-256-gcm",this.key,iv);
    const body=Buffer.concat([cipher.update(JSON.stringify(value),"utf8"),cipher.final()]);
    return [iv,cipher.getAuthTag(),body].map(x=>x.toString("base64")).join(".");
  }
  #open(line) {
    const [iv64,tag64,body64]=line.split(".");
    const decipher=crypto.createDecipheriv("aes-256-gcm",this.key,Buffer.from(iv64,"base64"));
    decipher.setAuthTag(Buffer.from(tag64,"base64"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body64,"base64")),decipher.final()]).toString("utf8"));
  }
  async append(table,record) {
    await this.init();
    await fs.appendFile(this.#file(table),this.#seal(record)+"\n","utf8");
    return record;
  }
  async list(table,limit=500) {
    await this.init();
    const lines=(await fs.readFile(this.#file(table),"utf8")).split("\n").filter(Boolean).slice(-Math.max(1,Math.min(5000,limit)));
    return lines.map(line=>this.#open(line));
  }
}
export const OMNI_SCHEMA=Object.freeze({
  search_runs:["id","query","mode","startedAt","finishedAt","status"],
  search_results:["id","runId","url","status","contentType","text","createdAt"],
  narrative_tracks:["id","projectId","branchId","timelineId","blocks","createdAt"],
  voice_assets:["id","trackId","filepath","metadata","createdAt"]
});
