const APPS = new Set(['KernelVision', 'XShield', 'Kernelodies', 'PlanetApeX', 'KashKorner', 'KoinKob']);
const ACTIONS = new Set(['read', 'write', 'delete', 'claim', 'publish', 'delegate']);
const CID = /^[a-f0-9]{64}$/;

export function normalizeAccessTensor(input, { now = Date.now() } = {}) {
  const namespace = input?.namespace;
  const version = Number(input?.version), issuedAt = Number(input?.issuedAt), expiresAt = Number(input?.expiresAt);
  if (!APPS.has(namespace) || input?.kind !== 'apex.access-tensor.v1' ||
      !Number.isSafeInteger(version) || version < 1 || !Number.isSafeInteger(issuedAt) ||
      !Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt <= issuedAt ||
      expiresAt - issuedAt > 366 * 86400000) throw new TypeError('invalid or expired access tensor');
  const previousCid = input.previousCid == null ? null : String(input.previousCid);
  if ((version === 1) !== (previousCid === null) || (previousCid !== null && !CID.test(previousCid))) {
    throw new TypeError('access tensor version and predecessor CID disagree');
  }
  if (!Array.isArray(input.rules) || input.rules.length > 4096) throw new TypeError('access tensor rules exceed bounds');
  const rules = input.rules.map(rule => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) throw new TypeError('invalid access rule');
    const subject = String(rule.subject || ''), resource = String(rule.resource || '');
    const actions = [...new Set(Array.isArray(rule.actions) ? rule.actions : [])].sort();
    if (!/^(\*|[A-Za-z0-9._:@-]{1,160})$/.test(subject) ||
        !/^[A-Za-z0-9._:/-]{1,256}$/.test(resource) ||
        resource.split('/').some(part => part === '.' || part === '..') ||
        !actions.length || actions.some(action => !ACTIONS.has(action))) throw new TypeError('invalid access rule scope');
    return Object.freeze({ subject, resource, actions, effect: rule.effect === 'deny' ? 'deny' : 'allow' });
  }).sort((a, b) => a.subject.localeCompare(b.subject) || a.resource.localeCompare(b.resource) ||
    a.effect.localeCompare(b.effect) || a.actions.join(',').localeCompare(b.actions.join(',')));
  return Object.freeze({ kind: 'apex.access-tensor.v1', namespace, version, issuedAt, expiresAt, previousCid, rules });
}

/** Pure, deny-by-default policy evaluation. A deny rule always overrides allows. */
export function evaluateAccessTensor(tensor, { namespace, subject, resource, action, now = Date.now() } = {}) {
  try {
    const policy = normalizeAccessTensor(tensor, { now });
    if (policy.namespace !== namespace || typeof subject !== 'string' ||
        typeof resource !== 'string' || !ACTIONS.has(action)) return false;
    const matches = policy.rules.filter(rule => (rule.subject === '*' || rule.subject === subject) &&
      (resource === rule.resource || resource.startsWith(rule.resource + '/')) && rule.actions.includes(action));
    return matches.length > 0 && !matches.some(rule => rule.effect === 'deny') &&
      matches.some(rule => rule.effect === 'allow');
  } catch { return false; }
}

/** Store immutable policy content, then CAS-swap the active CID pointer. */
export async function publishAccessTensor({ store, cas, tensor, expectedPointerHash = null, now = Date.now() } = {}) {
  if (!store || typeof store.putObject !== 'function' || !cas ||
      typeof cas.readRef !== 'function' || typeof cas.writeRef !== 'function') {
    throw new TypeError('peer object store and atomic CAS adapter are required');
  }
  const policy = normalizeAccessTensor(tensor, { now });
  if (store.namespace !== policy.namespace || cas.namespace !== policy.namespace) {
    throw new Error('access tensor store and CAS app namespaces must match');
  }
  const current = await cas.readRef('access-tensors', 'active');
  if ((current?.hash ?? null) !== expectedPointerHash) {
    const error = new Error('active access tensor pointer changed'); error.code = 'CAS_CONFLICT'; throw error;
  }
  if (policy.version > 1 && policy.previousCid !== current?.value?.cid) {
    throw new Error('access tensor predecessor does not match the active CID');
  }
  const receipt = await store.putObject(policy);
  if (!CID.test(String(receipt?.hash || '')) || receipt.namespace !== policy.namespace ||
      !Array.isArray(receipt.receipts) || receipt.receipts.length < Number(store.replicaCount || 1)) {
    throw new Error('access tensor CID lacks verified replica receipts');
  }
  const pointer = await cas.writeRef('access-tensors', 'active', {
    kind: 'apex.access-tensor-pointer.v1', namespace: policy.namespace, version: policy.version,
    cid: receipt.hash, updatedAt: now
  }, { expectedHash: expectedPointerHash });
  return Object.freeze({ cid: receipt.hash, version: policy.version, pointerHash: pointer.hash, namespace: policy.namespace });
}

export async function loadAccessTensor({ store, cas, namespace, now = Date.now() } = {}) {
  if (!APPS.has(namespace) || !store || typeof store.getObject !== 'function' || !cas ||
      typeof cas.readRef !== 'function' || store.namespace !== namespace || cas.namespace !== namespace) {
    throw new TypeError('app-scoped peer object store and CAS adapter are required');
  }
  const pointer = await cas.readRef('access-tensors', 'active');
  if (!pointer) return null;
  const value = pointer.value;
  if (value?.kind !== 'apex.access-tensor-pointer.v1' || value.namespace !== namespace ||
      !CID.test(String(value.cid || '')) || !Number.isSafeInteger(value.version)) throw new Error('malformed access tensor pointer');
  const tensor = normalizeAccessTensor(await store.getObject(value.cid), { now });
  if (tensor.namespace !== namespace || tensor.version !== value.version) throw new Error('access tensor CID/pointer mismatch');
  return Object.freeze({ cid: value.cid, pointerHash: pointer.hash, tensor });
}
