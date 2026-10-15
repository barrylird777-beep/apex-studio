/**
 * Namespace adapter for the peer-owned CAS. No coordinator-local persistence.
 * Mesh logical namespaces are encoded into reference keys inside one canonical
 * application namespace; the peer store enforces app isolation and quorum.
 */
const validPart = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(value);

export class PeerMeshCasAdapter {
  constructor({ store, appNamespace } = {}) {
    if (!store || typeof store.readRef !== 'function' || typeof store.writeRef !== 'function' ||
        typeof store.listRefs !== 'function') {
      throw new TypeError('PeerMeshCasAdapter requires a peer-backed reference store');
    }
    if (!validPart(appNamespace)) throw new TypeError('a canonical application namespace is required');
    this.store = store;
    this.appNamespace = appNamespace;
  }

  refKey(namespace, key) {
    if (!validPart(namespace) || !validPart(key)) throw new TypeError('invalid mesh reference namespace or key');
    return namespace + '/' + key;
  }

  async init() {
    await this.store.listRefs();
    return this;
  }

  async readRef(namespace, key) {
    return this.store.readRef(this.refKey(namespace, key));
  }

  async writeRef(namespace, key, value, options = {}) {
    return this.store.writeRef(this.refKey(namespace, key), value, options);
  }

  async listRefs(namespace) {
    if (!validPart(namespace)) throw new TypeError('invalid mesh reference namespace');
    const prefix = namespace + '/';
    const refs = await this.store.listRefs();
    return refs.filter(ref => ref.namespace === this.appNamespace && ref.key.startsWith(prefix))
      .map(ref => ({ ...ref, namespace, key: ref.key.slice(prefix.length) }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }
}
