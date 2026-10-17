import crypto from "node:crypto";

export const APEX_DATA_APPS = Object.freeze([
  "planetapex", "xshield", "kernelvision", "koinkob", "kashkorner", "kernelodies"
]);
const CLASSIFICATIONS = new Set(["public", "internal", "derived", "personal", "sensitive"]);
const PURPOSES = new Set(["product_delivery", "analytics", "research", "commercial_license", "support"]);
const COMMERCIAL_LICENSES = new Set(["subscription", "one_time", "usage_based", "enterprise"]);
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

function requiredString(value, field, max = 256) {
  const result = String(value ?? "").trim();
  if (!result || result.length > max) throw new TypeError(field + " is required and must be at most " + max + " characters");
  return result;
}
function boundedList(value, field, allowed = null) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(field + " must be a non-empty array");
  const items = [...new Set(value.map(x => requiredString(x, field, 128)))];
  if (allowed && items.some(x => !allowed.has(x))) throw new TypeError(field + " contains an unsupported value");
  return items;
}
function clone(value) { return structuredClone(value); }

/**
 * In-memory governance primitives for APEX data products. This is not a durable
 * catalog or an authentication system: callers must persist through the approved
 * store and supply identity/authorization from the trusted control plane.
 */
export class DataProductRegistry {
  #products = new Map();
  #grants = new Map();
  #audit = [];
  #clock;
  #id;
  constructor({ clock = () => new Date().toISOString(), id = () => crypto.randomUUID() } = {}) {
    this.#clock = clock;
    this.#id = id;
  }

  register(input, { actor } = {}) {
    const owner = requiredString(actor, "actor", 128);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("data product must be an object");
    const productId = requiredString(input.id, "id", 128);
    if (!ID.test(productId)) throw new TypeError("id contains unsupported characters");
    if (this.#products.has(productId)) throw Object.assign(new Error("data product already exists"), { code: "DATA_PRODUCT_EXISTS" });
    const app = requiredString(input.app, "app", 64).toLowerCase();
    if (!APEX_DATA_APPS.includes(app)) throw new TypeError("app must be one of the six canonical APEX apps");
    const classification = requiredString(input.classification, "classification", 32).toLowerCase();
    if (!CLASSIFICATIONS.has(classification)) throw new TypeError("unsupported data classification");
    const sources = boundedList(input.sources, "sources");
    const purposes = boundedList(input.allowedPurposes, "allowedPurposes", PURPOSES);
    const schema = Array.isArray(input.schema) ? input.schema.map(field => {
      if (!field || typeof field !== "object") throw new TypeError("schema fields must be objects");
      const name = requiredString(field.name, "schema field name", 128);
      const type = requiredString(field.type, "schema field type", 64);
      const sensitivity = String(field.sensitivity ?? "ordinary").toLowerCase();
      if (!["ordinary", "personal", "sensitive", "identifier"].includes(sensitivity)) throw new TypeError("unsupported field sensitivity");
      return { name, type, sensitivity };
    }) : [];
    if (!schema.length) throw new TypeError("schema must document at least one field");
    const lineage = Array.isArray(input.lineage) ? input.lineage.map(entry => {
      if (!entry || typeof entry !== "object") throw new TypeError("lineage entries must be objects");
      return {
        source: requiredString(entry.source, "lineage source", 256),
        transform: requiredString(entry.transform, "lineage transform", 256),
        verified: entry.verified === true
      };
    }) : [];
    const product = {
      id: productId,
      app,
      owner,
      title: requiredString(input.title, "title", 200),
      description: requiredString(input.description, "description", 2000),
      version: requiredString(input.version ?? "1.0.0", "version", 64),
      classification,
      sources,
      schema,
      lineage,
      allowedPurposes: purposes,
      quality: {
        score: Number.isFinite(input.quality?.score) ? Math.max(0, Math.min(1, input.quality.score)) : null,
        checkedAt: input.quality?.checkedAt ? requiredString(input.quality.checkedAt, "quality.checkedAt", 64) : null,
        limitations: Array.isArray(input.quality?.limitations) ? input.quality.limitations.map(x => String(x).slice(0, 500)).slice(0, 20) : []
      },
      license: input.license && typeof input.license === "object" ? {
        model: requiredString(input.license.model, "license.model", 64),
        currency: String(input.license.currency ?? "USD").toUpperCase(),
        price: Number(input.license.price),
        termsVersion: requiredString(input.license.termsVersion, "license.termsVersion", 64)
      } : null,
      createdAt: this.#clock(),
      updatedAt: this.#clock(),
      status: "draft"
    };
    if (product.license && (!COMMERCIAL_LICENSES.has(product.license.model) ||
      !/^[A-Z]{3}$/.test(product.license.currency) ||
      !Number.isFinite(product.license.price) || product.license.price < 0)) {
      throw new TypeError("license must use a supported model, ISO-style currency code, and non-negative finite price");
    }
    this.#products.set(productId, product);
    this.#record({ actor: owner, action: "data_product.register", productId, app, outcome: "allowed" });
    return clone(product);
  }

  publish(productId, { actor } = {}) {
    const product = this.#ownedProduct(productId, actor);
    if (product.lineage.length === 0 || product.lineage.some(item => !item.verified)) {
      throw Object.assign(new Error("verified source lineage is required before publication"), { code: "LINEAGE_UNVERIFIED" });
    }
    if (product.quality.score === null || product.quality.score < 0.8) {
      throw Object.assign(new Error("a recorded quality score of at least 0.8 is required"), { code: "QUALITY_GATE_FAILED" });
    }
    if (product.schema.some(field => field.sensitivity !== "ordinary") &&
      !(product.classification === "derived" && product.schema.every(field => field.sensitivity === "ordinary"))) {
      throw Object.assign(new Error("personal, sensitive, and identifier fields cannot be published as a commercial data product"), { code: "SENSITIVE_DATA_PUBLICATION_DENIED" });
    }
    if (product.classification === "personal" || product.classification === "sensitive") {
      throw Object.assign(new Error("personal or sensitive datasets cannot be published for sale"), { code: "SENSITIVE_DATA_PUBLICATION_DENIED" });
    }
    if (product.allowedPurposes.includes("commercial_license") && !product.license) {
      throw Object.assign(new Error("commercial licensing requires explicit pricing and versioned terms"), { code: "LICENSE_REQUIRED" });
    }
    product.status = "published";
    product.updatedAt = this.#clock();
    this.#record({ actor: String(actor), action: "data_product.publish", productId, app: product.app, outcome: "allowed" });
    return clone(product);
  }

  grant({ productId, subject, app, purposes, expiresAt, consentReceipt }, { actor } = {}) {
    const product = this.#products.get(requiredString(productId, "productId", 128));
    if (!product || product.status !== "published") throw Object.assign(new Error("published data product not found"), { code: "DATA_PRODUCT_UNAVAILABLE" });
    const grantActor = requiredString(actor, "actor", 128);
    if (grantActor !== product.owner) throw Object.assign(new Error("only the product owner may issue access grants"), { code: "GRANT_OWNER_REQUIRED" });
    const normalizedApp = requiredString(app, "app", 64).toLowerCase();
    if (normalizedApp !== product.app) throw Object.assign(new Error("cross-app data access requires a separately registered product and explicit owner authorization"), { code: "APP_NAMESPACE_MISMATCH" });
    const grantPurposes = boundedList(purposes, "purposes", PURPOSES);
    if (grantPurposes.some(purpose => !product.allowedPurposes.includes(purpose))) throw Object.assign(new Error("grant purpose exceeds product contract"), { code: "PURPOSE_NOT_ALLOWED" });
    if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.parse(this.#clock()))) throw new TypeError("expiresAt must be a future timestamp");
    if ((product.classification === "personal" || product.classification === "sensitive") && !consentReceipt) {
      throw Object.assign(new Error("documented consent receipt required"), { code: "CONSENT_REQUIRED" });
    }
    const grant = {
      id: this.#id(), productId, subject: requiredString(subject, "subject", 128), app: normalizedApp,
      purposes: grantPurposes, expiresAt: expiresAt ?? null,
      consentReceipt: consentReceipt ? requiredString(consentReceipt, "consentReceipt", 256) : null,
      grantedBy: grantActor, createdAt: this.#clock(), revokedAt: null
    };
    this.#grants.set(grant.id, grant);
    this.#record({ actor: grantActor, action: "data_access.grant", productId, app: normalizedApp, subject: grant.subject, outcome: "allowed" });
    return clone(grant);
  }

  authorize({ productId, subject, app, purpose, grantId }) {
    const product = this.#products.get(String(productId));
    const grant = this.#grants.get(String(grantId));
    const normalizedApp = String(app ?? "").toLowerCase();
    const denied = reason => {
      this.#record({ actor: String(subject ?? "unknown"), action: "data_access.authorize", productId: String(productId), app: normalizedApp, purpose: String(purpose ?? ""), outcome: "denied", reason });
      return { allowed: false, reason };
    };
    if (!product || product.status !== "published") return denied("product-unavailable");
    if (!grant || grant.productId !== product.id || grant.subject !== subject || grant.revokedAt) return denied("grant-missing-or-revoked");
    if (grant.app !== normalizedApp || product.app !== normalizedApp) return denied("app-namespace-mismatch");
    if (!PURPOSES.has(purpose) || !product.allowedPurposes.includes(purpose) || !grant.purposes.includes(purpose)) return denied("purpose-not-authorized");
    if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.parse(this.#clock())) return denied("grant-expired");
    this.#record({ actor: String(subject), action: "data_access.authorize", productId: product.id, app: normalizedApp, purpose, outcome: "allowed" });
    return { allowed: true, productId: product.id, app: normalizedApp, purpose, license: clone(product.license) };
  }

  revokeGrant(grantId, { actor } = {}) {
    const grant = this.#grants.get(String(grantId));
    if (!grant) return false;
    if (String(actor ?? "") !== grant.grantedBy) throw Object.assign(new Error("only the grant issuer may revoke this grant"), { code: "GRANT_OWNER_REQUIRED" });
    if (!grant.revokedAt) {
      grant.revokedAt = this.#clock();
      this.#record({ actor: String(actor), action: "data_access.revoke", productId: grant.productId, app: grant.app, subject: grant.subject, outcome: "allowed" });
    }
    return true;
  }

  get(productId, { actor } = {}) {
    const product = this.#products.get(String(productId));
    if (!product) return null;
    if (product.classification !== "public" && String(actor ?? "") !== product.owner) return null;
    return clone(product);
  }

  list({ app, actor } = {}) {
    const normalizedApp = app ? String(app).toLowerCase() : null;
    return [...this.#products.values()]
      .filter(product => (!normalizedApp || product.app === normalizedApp) &&
        (product.status === "published" && product.classification === "public" || product.owner === actor))
      .map(clone);
  }

  audit({ actor } = {}) {
    if (!actor) throw new Error("audit access requires an authenticated actor");
    return this.#audit.map(event => ({ ...event }));
  }

  #ownedProduct(productId, actor) {
    const product = this.#products.get(String(productId));
    if (!product) throw Object.assign(new Error("data product not found"), { code: "DATA_PRODUCT_UNAVAILABLE" });
    if (!actor || String(actor) !== product.owner) throw Object.assign(new Error("product owner authorization required"), { code: "PRODUCT_OWNER_REQUIRED" });
    return product;
  }

  #record(event) {
    this.#audit.push({ id: this.#id(), at: this.#clock(), ...event });
    if (this.#audit.length > 10000) this.#audit.splice(0, this.#audit.length - 10000);
  }
}
