const BUILTIN_AD_TRACKER_HOSTS = new Set([
  "doubleclick.net","googlesyndication.com","googleadservices.com","googletagmanager.com",
  "googletagservices.com","adservice.google.com","adsrvr.org","adnxs.com","taboola.com",
  "outbrain.com","scorecardresearch.com","zedo.com","rubiconproject.com","criteo.com",
  "pubmatic.com","openx.net","app-measurement.com"
]);

const AD_SEGMENTS = new Set([
  "ad","ads","adserver","adservice","advert","advertising","banner","banners","beacon",
  "clicktrack","clicktracker","conversion","doubleclick","gads","pixel","pixels",
  "retarget","telemetry","tracking","tracker","track","analytics"
]);

function normalizeHost(value) {
  return String(value || "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}

function hostParts(host) {
  return normalizeHost(host).split(".").filter(Boolean);
}

function isUnder(host, root) {
  const h = normalizeHost(host);
  const r = normalizeHost(root);
  return h === r || h.endsWith("." + r);
}

function looksDedicated(host) {
  const parts = hostParts(host);
  if (BUILTIN_AD_TRACKER_HOSTS.has(host)) return true;
  return parts.some(part => AD_SEGMENTS.has(part));
}

function isFirstParty(url, firstPartyHost) {
  if (!firstPartyHost) return false;
  return isUnder(firstPartyHost, url.hostname);
}

export function classifyNetworkRequest(rawUrl, { firstPartyHost = "", resourceType = "other" } = {}) {
  let url;
  try { url = new URL(String(rawUrl)); } catch { return { action:"allow", reason:"invalid-url", confidence:0 }; }

  if (!["http:","https:"].includes(url.protocol)) {
    return { action:"allow", reason:"non-http", confidence:1 };
  }

  const host = normalizeHost(url.hostname);
  if (!host) return { action:"allow", reason:"no-host", confidence:1 };

  if (isFirstParty(url, firstPartyHost)) {
    return { action:"allow", reason:"first-party", confidence:1, host };
  }

  if (looksDedicated(host)) {
    return { action:"block", reason:"dedicated-ad-or-tracker-host", confidence:0.98, host, resourceType };
  }

  const path = url.pathname.toLowerCase();
  const query = url.search.toLowerCase();
  const suspicious = /(^|[\/_-])(ad|ads|advert|banner|beacon|pixel|tracking|tracker|telemetry)([\/_?.=-]|$)/.test(path)
    || /(^|[&?_-])(utm_|gclid|fbclid|msclkid|dclid|_ga=|tracking|telemetry)/.test(query);

  if (suspicious && ["script","image","raw","style-sheet"].includes(resourceType)) {
    return { action:"block", reason:"ad-tracker-request-pattern", confidence:0.9, host, resourceType };
  }

  return { action:"allow", reason:"uncertain-allow-by-default", confidence:0.5, host, resourceType };
}

export function buildSafariContentBlockerRules(hosts = BUILTIN_AD_TRACKER_HOSTS) {
  const rules = [];
  for (const host of hosts) {
    const domain = normalizeHost(host);
    if (!domain || domain.includes(" ") || domain.length > 253) continue;
    rules.push({
      trigger: {
        "url-filter": ".*",
        "if-domain": ["*." + domain, domain],
        "resource-type": ["script","image","raw","style-sheet","font"]
      },
      action: { type: "block" }
    });
  }
  return rules;
}

export function contentFilterStatus(blockedDomains = BUILTIN_AD_TRACKER_HOSTS.size) {
  return {
    enabled: true,
    policy: "content-level-ad-tracker-filter",
    defaultAction: "allow",
    firstPartyPolicy: "always-allow",
    dnsFallback: true,
    safariRules: buildSafariContentBlockerRules().length,
    blockedDomains,
    supportedPlanes: ["api-classifier","safari-content-blocker","dns-fallback"],
    unsupportedPromise: "Universal arbitrary-iOS-app HTTPS inspection requires an Apple Network Extension/content-filter app with the required entitlements."
  };
}
