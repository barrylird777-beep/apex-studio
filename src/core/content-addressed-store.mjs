const disabled = () => Object.assign(
  new Error('coordinator-local CAS persistence is disabled; use the authenticated peer CAS'),
  { code: 'NONCOMPLIANT_STORAGE_DISABLED' }
);

/**
 * Compatibility shim for retired coordinator-local CAS call sites.
 * APEX state must be written through the authenticated, app-scoped peer CAS.
 * This module deliberately performs no filesystem reads or writes.
 */
export class ContentAddressedStore {
  constructor({ root } = {}) {
    if (!root) throw new TypeError('ContentAddressedStore requires an explicit root');
    this.root = String(root);
    this.namespace = null;
  }

  async init() { throw disabled(); }
  async putObject() { throw disabled(); }
  async getObject() { throw disabled(); }
  async writeRef() { throw disabled(); }
  async readRef() { throw disabled(); }
  async listRefs() { throw disabled(); }
  async deleteRef() { throw disabled(); }
}

export default ContentAddressedStore;
