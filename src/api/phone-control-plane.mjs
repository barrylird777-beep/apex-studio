import express from 'express';
import crypto from 'node:crypto';
import {
  cloudStorageStatus, listCloudObjects, createUploadUrl, createDownloadUrl,
  inspectCloudObject, deleteCloudObject, multipartPlan,
  initiateMultipartUpload, signMultipartPart, listMultipartParts,
  completeMultipartUpload, abortMultipartUpload
} from '../storage/cloud-object-store.mjs';

const PHONE_PREFIX = 'phone-private';

function tokenMatches(expected, supplied) {
  if (!expected || !supplied) return false;
  const a = Buffer.from(String(expected)), b = Buffer.from(String(supplied));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requirePhoneAuth(req, res, next) {
  const expected = process.env.APEX_SHORTCUT_TOKEN;
  if (!expected) return res.status(503).json({ success: false, error: 'Phone control plane is not configured' });
  const supplied = req.get('x-apex-shortcut-token') || req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!tokenMatches(expected, supplied)) return res.status(401).json({ success: false, error: 'Unauthorized' });
  return next();
}

export function createPhoneControlPlane({ getHealth, getNetwork } = {}) {
  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));
  router.use(requirePhoneAuth);

  router.get('/status', async (_req, res) => {
    const [health, network] = await Promise.allSettled([getHealth?.(), getNetwork?.()]);
    return res.json({
      success: true,
      controlPlane: 'personal-phone',
      isolation: { storageNamespace: PHONE_PREFIX, businessNamespace: 'separate', acceptsCallerSelectedPrefix: false },
      device: { role: 'cache-and-working-set', cloudRole: 'durable-personal-device-vault' },
      health: health.status === 'fulfilled' ? health.value : { ok: false },
      network: network.status === 'fulfilled' ? network.value : { ok: false },
      storage: cloudStorageStatus()
    });
  });

  router.get('/storage', async (req, res) => {
    try {
      return res.json({ success: true, ...(await listCloudObjects({ prefix: PHONE_PREFIX, limit: req.query.limit, continuationToken: req.query.cursor })) });
    } catch (error) { return res.status(503).json({ success: false, error: String(error?.message || error) }); }
  });

  router.post('/storage/upload-url', async (req, res) => {
    try {
      const body = req.body || {};
      return res.json({ success: true, ...(await createUploadUrl({ filename: body.filename, contentType: body.contentType, size: body.size, prefix: PHONE_PREFIX })) });
    } catch (error) {
      const status = Number(error?.status);
      return res.status(Number.isInteger(status) && status >= 400 && status < 600 ? status : 503).json({ success: false, error: String(error?.message || error) });
    }
  });

  router.post('/storage/download-url', async (req, res) => {
    try { return res.json({ success: true, ...(await createDownloadUrl({ key: String(req.body?.key || ''), prefix: PHONE_PREFIX })) }); }
    catch (error) { return res.status(503).json({ success: false, error: String(error?.message || error) }); }
  });

  router.post('/storage/inspect', async (req, res) => {
    try { return res.json({ success: true, ...(await inspectCloudObject({ key: String(req.body?.key || ''), prefix: PHONE_PREFIX })) }); }
    catch (error) { return res.status(503).json({ success: false, error: String(error?.message || error) }); }
  });

  router.delete('/storage', async (req, res) => {
    try { return res.json({ success: true, ...(await deleteCloudObject({ key: String(req.query.key || ''), prefix: PHONE_PREFIX })) }); }
    catch (error) { return res.status(503).json({ success: false, error: String(error?.message || error) }); }
  });

  router.post('/storage/multipart/initiate', async (req, res) => {
    try { return res.json({ success: true, ...(await initiateMultipartUpload({ ...(req.body || {}), prefix: PHONE_PREFIX })) }); }
    catch (error) { return res.status(503).json({ success: false, error: String(error?.message || error) }); }
  });

  router.post('/storage/multipart/part-url', async (req, res) => {
    try { return res.json({ success: true, ...(await signMultipartPart({ ...(req.body || {}), prefix: PHONE_PREFIX })) }); }
    catch (error) { return res.status(503).json({ success: false, error: String(error?.message || error) }); }
  });

  router.post('/storage/multipart/parts', async (req, res) => {
    try { return res.json({ success: true, ...(await listMultipartParts({ ...(req.body || {}), prefix: PHONE_PREFIX })) }); }
    catch (error) { return res.status(503).json({ success: false, error: String(error?.message || error) }); }
  });

  router.post('/storage/multipart/complete', async (req, res) => {
    try { return res.json({ success: true, ...(await completeMultipartUpload({ ...(req.body || {}), prefix: PHONE_PREFIX })) }); }
    catch (error) { return res.status(503).json({ success: false, error: String(error?.message || error) }); }
  });

  router.post('/storage/multipart/abort', async (req, res) => {
    try { return res.json({ success: true, ...(await abortMultipartUpload({ ...(req.body || {}), prefix: PHONE_PREFIX })) }); }
    catch (error) { return res.status(503).json({ success: false, error: String(error?.message || error) }); }
  });

  router.post('/storage/multipart/plan', (req, res) => {
    try { return res.json({ success: true, ...multipartPlan(req.body || {}) }); }
    catch (error) { return res.status(503).json({ success: false, error: String(error?.message || error) }); }
  });

  router.get('/storage/status', (_req, res) => res.json({
    success: true, ...cloudStorageStatus(), namespace: PHONE_PREFIX, isolation: 'personal-device-only'
  }));

  return router;
}
