import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const target = process.env.APEX_NEGATIVE_TLS_TARGET ?? "git.apex.internal:443";
const serverName = process.env.APEX_NEGATIVE_TLS_SERVER_NAME ?? target.split(":")[0];
const caPath = process.env.APEX_NEGATIVE_TLS_CA ?? `${process.env.APEX_CA_DIR ?? "/srv/apex/secrets/ca"}/ca.crt`;

function runTls(version) {
  try {
    const stdout = execFileSync(
      "openssl",
      [
        "s_client",
        "-connect", target,
        "-servername", serverName,
        "-CAfile", caPath,
        "-verify_return_error",
        version,
        "-brief"
      ],
      { input: "", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    );
    return { status: 0, output: stdout };
  } catch (error) {
    return {
      status: Number.isInteger(error.status) ? error.status : 1,
      output: String(error.stdout ?? "") + String(error.stderr ?? "")
    };
  }
}

function assertDeploymentReachable() {
  const result = runTls("-tls1_2");
  assert.match(
    result.output,
    /Protocol version:\s*TLSv1\.2/i,
    `TLS 1.2 preflight failed for ${target}. Deployment must be reachable before negative protocol results are meaningful.\n${result.output}`
  );
}

function assertLegacyRejected(version, label) {
  const result = runTls(version);
  assert.doesNotMatch(
    result.output,
    new RegExp(`Protocol version:\\s*TLSv1\\.${label}\\b`, "i"),
    `Security failure: ${target} negotiated legacy TLS ${label}.\n${result.output}`
  );
  assert.ok(
    result.status !== 0 || /handshake failure|protocol version|wrong version number|unsupported protocol|no protocols available|alert/i.test(result.output),
    `TLS ${label} did not produce a recognizable rejection signal.\n${result.output}`
  );
}

test("deployed perimeter rejects TLS 1.0", () => {
  assertDeploymentReachable();
  assertLegacyRejected("-tls1", "1.0");
});

test("deployed perimeter rejects TLS 1.1", () => {
  assertDeploymentReachable();
  assertLegacyRejected("-tls1_1", "1.1");
});
