import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

/**
 * Validated Apex desired-state manifest.
 * This file describes bounded configuration; it does not bypass or disable
 * runtime security controls.
 */
export const SOVEREIGN_CONFIG_SCHEMA = {
  version: '4.1.1-hardened',
  scope: 'GLOBAL_SYSTEM_VALIDATION',
  subsystems: {
    apexStudio: {
      concurrency: 32,
      maxBatchSize: 20,
      leaseDurationMs: 45000,
      renderPreset: {
        resolution: '2560x1440',
        framerate: 24,
        crf: 17,
        audioProfile: 'EBU R128'
      },
      storagePath: process.env.APEX_STORAGE_PATH || '/srv/apex/se-x/projects'
    },
    ringWal: {
      storageEngine: 'postgresql',
      syncMode: 'transactional'
    },
    security: {
      mode: 'deny_by_default',
      enforceNoiseTransport: true,
      allowedPeerIds: process.env.APEX_ALLOWED_PEER_IDS
        ? process.env.APEX_ALLOWED_PEER_IDS.split(',').map((id) => id.trim()).filter(Boolean)
        : []
    }
  }
};

function assertPositiveInteger(value, field) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`[VALIDATION_ERROR] ${field} must be a positive integer.`);
  }
}

export function validateManifest(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('[VALIDATION_ERROR] Manifest must be an object.');
  }

  const {apexStudio, ringWal, security} = config.subsystems || {};

  if (!config.version || !apexStudio || !ringWal || !security) {
    throw new Error('[VALIDATION_ERROR] Missing mandatory manifest fields.');
  }

  if (security.mode !== 'deny_by_default') {
    throw new Error('[SECURITY_VIOLATION] Security mode must be deny_by_default.');
  }

  if (security.enforceNoiseTransport !== true) {
    throw new Error('[SECURITY_VIOLATION] Noise transport enforcement must be enabled.');
  }

  if (ringWal.storageEngine !== 'postgresql') {
    throw new Error('[VALIDATION_ERROR] Ring WAL storage must use PostgreSQL.');
  }

  assertPositiveInteger(apexStudio.concurrency, 'apexStudio.concurrency');
  assertPositiveInteger(apexStudio.maxBatchSize, 'apexStudio.maxBatchSize');
  assertPositiveInteger(apexStudio.leaseDurationMs, 'apexStudio.leaseDurationMs');

  if (apexStudio.maxBatchSize > apexStudio.concurrency) {
    throw new Error('[VALIDATION_ERROR] maxBatchSize cannot exceed concurrency.');
  }

  if (!/^\\d+x\\d+$/.test(apexStudio.renderPreset.resolution)) {
    throw new Error('[VALIDATION_ERROR] Invalid render resolution.');
  }

  if (!Number.isInteger(apexStudio.renderPreset.framerate) || apexStudio.renderPreset.framerate <= 0) {
    throw new Error('[VALIDATION_ERROR] Invalid render framerate.');
  }

  if (!Number.isInteger(apexStudio.renderPreset.crf) || apexStudio.renderPreset.crf < 0 || apexStudio.renderPreset.crf > 51) {
    throw new Error('[VALIDATION_ERROR] CRF must be an integer from 0 through 51.');
  }

  if (!Array.isArray(security.allowedPeerIds) || security.allowedPeerIds.some((id) => typeof id !== 'string' || !id)) {
    throw new Error('[VALIDATION_ERROR] allowedPeerIds must be an array of non-empty strings.');
  }

  return true;
}

export function deployValidatedManifest(
  targetDir = process.env.APEX_CONFIG_DIR || '/srv/apex/se-x/config'
) {
  validateManifest(SOVEREIGN_CONFIG_SCHEMA);

  fs.mkdirSync(targetDir, {recursive: true, mode: 0o700});

  const finalPath = path.join(targetDir, 'sovereign_manifest.json');
  const tempPath = path.join(
    targetDir,
    `.sovereign_manifest.${crypto.randomBytes(8).toString('hex')}.tmp`
  );

  const payload = `${JSON.stringify(SOVEREIGN_CONFIG_SCHEMA, null, 2)}\\n`;

  try {
    fs.writeFileSync(tempPath, payload, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
    fs.renameSync(tempPath, finalPath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, {force: true});
    } catch {
      // Preserve the original deployment error.
    }
    throw error;
  }

  return finalPath;
}

const isMain = process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMain) {
  const deployedPath = deployValidatedManifest();
  console.log(`[APEX] Validated manifest deployed atomically to ${deployedPath}`);
}
