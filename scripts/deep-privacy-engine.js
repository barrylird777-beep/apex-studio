import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROTATION_INTERVAL_MS = 300000;
const SALTS = Object.freeze(["0x9F4B", "0x2A1C", "0x7E8D", "0xE5C3"]);
const PROFILES = Object.freeze(["ALPHA", "BRAVO", "CHARLIE"]);

function tokenize(rawPayload) {
  return String(rawPayload ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function signatureForToken(token, index) {
  const salt = SALTS[index % SALTS.length];
  const digest = crypto
    .createHash("sha256")
    .update(salt, "utf8")
    .update("\0", "utf8")
    .update(token, "utf8")
    .digest("hex")
    .slice(0, 6)
    .toUpperCase();

  return `[TK_${digest}]`;
}

function atomicWriteJson(filePath, value) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

  const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600
    });
    fs.renameSync(temporaryPath, filePath);
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // Best effort on platforms that do not expose chmod semantics.
    }
  } catch (error) {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // Preserve the original write error.
    }
    throw error;
  }
}

export class DeepPrivacyEngine {
  static salts = SALTS;
  static profiles = PROFILES;
  static rotationIntervalMs = ROTATION_INTERVAL_MS;

  constructor(options = {}) {
    this.matrixPath = path.resolve(
      options.matrixPath ?? path.join(__dirname, "..", "config", "routing-matrix.json")
    );
    this.rotationIntervalMs = Math.max(
      1,
      Number(options.rotationIntervalMs ?? ROTATION_INTERVAL_MS)
    );
    this.profileIndex = -1;
    this.rotationCount = 0;
    this.timerClearCount = 0;
    this.timer = null;
    this.lastWriteError = null;

    if (options.startTimer !== false) {
      this.timer = setInterval(() => {
        try {
          this.rotateRoutingArchitecture();
        } catch (error) {
          this.lastWriteError = error instanceof Error ? error.message : String(error);
        }
      }, this.rotationIntervalMs);
      this.timer.unref?.();
    }
  }

  generateScrambledSignature(rawPayload) {
    return tokenize(rawPayload).map((token, index) => signatureForToken(token, index));
  }

  rotateRoutingArchitecture() {
    this.profileIndex = (this.profileIndex + 1) % PROFILES.length;
    const profile = PROFILES[this.profileIndex];

    const state = {
      profile,
      profileIndex: this.profileIndex,
      rotationCount: this.rotationCount + 1,
      updatedAt: new Date().toISOString(),
      routing: {
        mode: "local-profile",
        externalConnections: false
      }
    };

    try {
      atomicWriteJson(this.matrixPath, state);
      this.rotationCount += 1;
      this.lastWriteError = null;
      return state;
    } catch (error) {
      this.lastWriteError = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  stop() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      this.timerClearCount += 1;
    }
    return this.metrics();
  }

  metrics() {
    return {
      profile: this.profileIndex >= 0 ? PROFILES[this.profileIndex] : null,
      profileIndex: this.profileIndex,
      rotationCount: this.rotationCount,
      timerActive: this.timer !== null,
      timerClearCount: this.timerClearCount,
      lastWriteError: this.lastWriteError
    };
  }
}

export { PROFILES, SALTS, ROTATION_INTERVAL_MS };

if (import.meta.url === `file://${process.argv[1]}`) {
  const engine = new DeepPrivacyEngine();
  try {
    const result = engine.rotateRoutingArchitecture();
    console.log(JSON.stringify({
      profile: result.profile,
      profileIndex: result.profileIndex,
      externalConnections: result.routing.externalConnections
    }));
  } catch (error) {
    console.error(`[deep-privacy-engine] local write failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    engine.stop();
  }
}
