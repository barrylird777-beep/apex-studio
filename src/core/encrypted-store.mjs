import crypto from "node:crypto";

export class EncryptedStore {
  constructor(passphrase) {
    this.key = crypto.createHash("sha256").update(String(passphrase)).digest();
    this.data = new Map();
  }

  set(name, value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    this.data.set(String(name), {
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      value: ciphertext.toString("base64")
    });
    return { name: String(name), stored: true };
  }

  get(name) {
    const record = this.data.get(String(name));
    if (!record) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, Buffer.from(record.iv, "base64"));
    decipher.setAuthTag(Buffer.from(record.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(record.value, "base64")),
      decipher.final()
    ]).toString("utf8");
    return JSON.parse(plaintext);
  }

  has(name) { return this.data.has(String(name)); }
  remove(name) { return this.data.delete(String(name)); }
  names() { return [...this.data.keys()]; }
}
