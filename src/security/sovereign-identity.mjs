import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';
import { paths } from '../core/sovereign-local-storage.mjs';

const DIR = process.env.APEX_IDENTITY_DIR || path.join(paths.ROOT, 'identity');
const PRIVATE = path.join(DIR, 'ed25519-private.pem');
const PUBLIC = path.join(DIR, 'ed25519-public.pem');

const b64 = value => Buffer.from(value).toString('base64url');
const unb64 = value => Buffer.from(value, 'base64url');
const stable = value => JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(k => [k, value[k]])));

async function ensureIdentity() {
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  try {
    const [privateKey, publicKey] = await Promise.all([
      fs.readFile(PRIVATE, 'utf8'),
      fs.readFile(PUBLIC, 'utf8')
    ]);
    return { privateKey, publicKey };
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const keys = generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    });
    await fs.writeFile(PRIVATE, keys.privateKey, { mode: 0o600 });
    await fs.writeFile(PUBLIC, keys.publicKey, { mode: 0o644 });
    return keys;
  }
}

export async function createSovereignIdentity() {
  const { privateKey, publicKey } = await ensureIdentity();
  const identityId = createHash('sha256').update(publicKey).digest('hex');
  return {
    identityId,
    publicKey,
    async issue(claims = {}, ttlSeconds = 60) {
      const now = Math.floor(Date.now() / 1000);
      const header = { alg: 'EdDSA', typ: 'JWT' };
      const payload = {
        iss: identityId,
        sub: identityId,
        iat: now,
        exp: now + Math.max(1, ttlSeconds),
        jti: randomUUID(),
        publicKey,\n        ...claims
      };
      const signingInput = b64(stable(header)) + '.' + b64(stable(payload));
      const signature = sign(null, Buffer.from(signingInput), privateKey);
      return signingInput + '.' + b64(signature);
    }
  };
}

export function verifySelfSignedJwt(token, expectedIdentityId = null) {
  if (typeof token !== 'string') throw new Error('missing self-signed JWT');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('invalid JWT shape');
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = JSON.parse(unb64(encodedHeader));
  const payload = JSON.parse(unb64(encodedPayload));
  if (header.alg !== 'EdDSA' || header.typ !== 'JWT') throw new Error('unsupported JWT algorithm');
  if (!payload.iss || !payload.iat || !payload.exp) throw new Error('invalid JWT claims');
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('JWT expired');
  if (expectedIdentityId && payload.iss !== expectedIdentityId) throw new Error('JWT identity mismatch');
  if (!payload.publicKey) throw new Error('JWT public key missing');
  const publicKey = payload.publicKey;
  const identityId = createHash('sha256').update(publicKey).digest('hex');
  if (identityId !== payload.iss) throw new Error('JWT public key identity mismatch');
  if (!verify(null, Buffer.from(encodedHeader + '.' + encodedPayload), publicKey, unb64(encodedSignature))) throw new Error('JWT signature invalid');
  return payload;
}

export { DIR, PRIVATE, PUBLIC };
