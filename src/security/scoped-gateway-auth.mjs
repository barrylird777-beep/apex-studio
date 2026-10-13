import crypto from "node:crypto";

function safeEqual(expected, supplied) {
  if (!expected || !supplied) return false;
  const a = Buffer.from(String(expected), "utf8");
  const b = Buffer.from(String(supplied), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function configuredTokens(raw = process.env.APEX_SCOPED_API_TOKENS || "") {
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(item =>
      item && typeof item.token === "string" && item.token.length >= 24 &&
      typeof item.appId === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/i.test(item.appId) &&
      Array.isArray(item.scopes) && item.scopes.every(scope => typeof scope === "string")
    ).map(item => ({ token: item.token, appId: item.appId, scopes: [...new Set(item.scopes)] }));
  } catch {
    return [];
  }
}

export function createScopedGatewayAuth({ getTokens = configuredTokens, getAdminToken = () => process.env.APEX_CONTROL_TOKEN || process.env.APEX_SHORTCUT_TOKEN } = {}) {
  return function requireScopedGatewayAuth({ scope, resolveAppId = req => req.get?.("x-apex-app-id") || req.body?.appId || "" } = {}) {
    return (req, res, next) => {
      const authorization = String(req.get?.("authorization") || "");
      const bearer = /^Bearer\s+([^\s]+)$/i.exec(authorization)?.[1] || "";
      const supplied = String(req.get?.("x-apex-control-token") || req.get?.("x-apex-shortcut-token") || bearer);
      const record = getTokens().find(item => safeEqual(item.token, supplied));
      if (record) {
        const requestedApp = String(resolveAppId(req) || "");
        res.set?.("Cache-Control", "no-store");
        if (requestedApp && requestedApp !== record.appId) return res.status(403).json({ success: false, error: "Token is not authorized for this application" });
        if (!record.scopes.includes(scope)) return res.status(403).json({ success: false, error: "Token is missing the required permission" });
        req.apexAuthorization = Object.freeze({ appId: record.appId, scopes: Object.freeze([...record.scopes]) });
        return next();
      }
      // Compatibility path: the single legacy control token is an administrator credential,
      // not an app-scoped token. Migrate clients to APEX_SCOPED_API_TOKENS to limit blast radius.
      if (safeEqual(getAdminToken(), supplied)) {
        req.apexAuthorization = Object.freeze({ appId: "admin", scopes: Object.freeze(["*"]) });
        return next();
      }
      res.set?.("Cache-Control", "no-store");
      return res.status(getTokens().length ? 401 : 503).json({
        success: false,
        error: getTokens().length ? "Unauthorized" : "Scoped API credentials are not configured"
      });
    };
  };
}

export const requireScopedGatewayAuth = createScopedGatewayAuth();
