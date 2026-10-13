import fs from "node:fs/promises";
import path from "node:path";

const exists = async candidate => {
  if (!candidate) return false;
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
};

const configured = name => Boolean(String(process.env[name] ?? "").trim());

/**
 * Safe, read-only snapshot of storage-related runtime configuration.
 *
 * This does not inspect secret values, open a database connection, touch WAL
 * files, or prove whether a configured backend is actually receiving traffic.
 * It is a baseline for a separately instrumented observation period.
 */
export async function auditStorageConfiguration() {
  const localPaths = [
    ["APEX_SE_X_ROOT", process.env.APEX_SE_X_ROOT],
    ["APEX_PROJECTS_DIR", process.env.APEX_PROJECTS_DIR],
    ["APEX_SOVEREIGN_STORAGE_DIR", process.env.APEX_SOVEREIGN_STORAGE_DIR],
    ["APEX_WAL_DIR", process.env.APEX_WAL_DIR],
    ["APEX_WAL_FILE", process.env.APEX_WAL_FILE]
  ];

  const localPathStatus = [];
  for (const [setting, rawPath] of localPaths) {
    if (!rawPath) {
      localPathStatus.push({ setting, configured: false, exists: false });
      continue;
    }
    const candidate = path.resolve(rawPath);
    localPathStatus.push({
      setting,
      configured: true,
      exists: await exists(candidate),
      kind: setting.endsWith("_FILE") ? "file-path-setting" : "directory-path-setting"
    });
  }

  const remoteNames = [
    "APEX_OBJECT_STORAGE_ENDPOINT",
    "APEX_OBJECT_STORAGE_BUCKET",
    "APEX_OBJECT_STORAGE_ACCESS_KEY_ID",
    "APEX_OBJECT_STORAGE_SECRET_ACCESS_KEY"
  ];
  const remoteConfigured = Object.fromEntries(remoteNames.map(name => [name, configured(name)]));

  return {
    readOnly: true,
    auditType: "configuration-baseline",
    timestamp: new Date().toISOString(),
    limitations: [
      "Configuration presence does not prove backend usage.",
      "This snapshot does not measure database queries or local WAL reads/writes.",
      "Do not remove legacy settings or data based on this report alone.",
      "A runtime instrumentation period is required to establish actual traffic."
    ],
    database: {
      DATABASE_URL_configured: configured("DATABASE_URL"),
      valueExposed: false
    },
    remoteObjectStorage: {
      settings: remoteConfigured,
      configurationComplete: remoteNames.every(configured),
      valuesExposed: false
    },
    localStoragePaths: localPathStatus
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  console.log("[STORAGE CONFIG AUDIT]", JSON.stringify(await auditStorageConfiguration()));
}
