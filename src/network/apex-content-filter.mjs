const AD_ONLY_HOSTS = new Set([
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "adnxs.com",
  "adsrvr.org",
  "taboola.com",
  "outbrain.com",
  "rubiconproject.com",
  "pubmatic.com",
  "openx.net",
  "criteo.com"
]);

const AD_PATH_PATTERN = /(?:^|[\\/_-])(ads?|adserver|adservice|advert(?:ising)?|banner|clicktrack(?:er)?|conversion|pixel|retarget)(?:[\\/_?.=-]|$)/i;
const AD_QUERY_PATTERN = /(?:^|[&?])(?:ad|ads|adid|adformat|ad_type|adtype|advert|advertiser|banner|clicktrack|conversion|gclid|dclid|fbclid|msclkid|tracking|tracker)=/i;
const BLOCKABLE_TYPES = new Set(["script", "image", "raw", "style-sheet", "font", "fetch", "other", "ping"]);

function normalizeHost(value) {
  return String(value || "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}

function isUnder(host, root) {
  const h = normalizeHost(host);
  const r = normalizeHost(root);
  return h === r || h.endsWith("." + r);
}

function isFirstParty(url, firstPartyHost) {
  return Boolean(firstPartyHost) && isUnder(url.hostname, firstPartyHost);
}

function isDedicatedAdHost(host) {
  return [...AD_ONLY_HOSTS].some(root => isUnder(host, root));
}

export function classifyNetworkRequest(rawUrl, { firstPartyHost = "", resourceType = "other" } = {}) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    return { action: "allow", reason: "invalid-url", confidence: 0 };
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return { action: "allow", reason: "non-http", confidence: 1 };
  }

  const host = normalizeHost(url.hostname);
  if (!host) return { action: "allow", reason: "no-host", confidence: 1 };

  if (isFirstParty(url, firstPartyHost)) {
    return { action: "allow", reason: "first-party", confidence: 1, host };
  }

  if (isDedicatedAdHost(host)) {
    return {
      action: "block",
      reason: "dedicated-ad-host",
      confidence: 0.99,
      host,
      resourceType
    };
  }

  if (!BLOCKABLE_TYPES.has(resourceType)) {
    return { action: "allow", reason: "resource-type-not-safe-to-block", confidence: 0.8, host, resourceType };
  }

  const path = url.pathname;
  const query = url.search;

  if (AD_PATH_PATTERN.test(path) || AD_QUERY_PATTERN.test(query)) {
    return {
      action: "block",
      reason: "high-confidence-ad-request-pattern",
      confidence: 0.92,
      host,
      resourceType
    };
  }

  return {
    action: "allow",
    reason: "uncertain-allow-by-default",
    confidence: 0.5,
    host,
    resourceType
  };
}

export function buildSafariContentBlockerRules() {
  const rules = [
    {
      trigger: {
        "url-filter": "(^|[\\/_-])(ads?|adserver|adservice|advert(?:ising)?|banner|clicktrack(?:er)?|conversion|pixel|retarget)([\\/_?.=-]|$)",
        "resource-type": ["script", "image", "raw", "style-sheet", "font", "fetch", "other", "ping"]
      },
      action: { type: "block" }
    },
    {
      trigger: {
        "url-filter": "[?&](ad|ads|adid|adformat|ad_type|adtype|advert|advertiser|banner|clicktrack|conversion|gclid|dclid|fbclid|msclkid|tracking|tracker)=",
        "resource-type": ["script", "image", "raw", "style-sheet", "font", "fetch", "other", "ping"]
      },
      action: { type: "block" }
    },
    {
      trigger: {
        "url-filter": ".*",
        "if-domain": ["*.youtube.com", "youtube.com", "*.youtube-nocookie.com", "youtube-nocookie.com"],
      },
      action: {
        type: "css-display-none",
        selector: "ytd-display-ad-renderer, ytd-promoted-sparkles-web-renderer, ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, .ytp-ad-overlay-container, .ytp-ad-overlay-slot, .ytp-ad-text-overlay"
      }
    }
  ];

  for (const host of AD_ONLY_HOSTS) {
    rules.push({
      trigger: {
        "url-filter": ".*",
        "if-domain": ["*." + host, host],
        "resource-type": ["script", "image", "raw", "style-sheet", "font", "fetch", "other", "ping"]
      },
      action: { type: "block" }
    });
  }

  return rules;
}

export function contentFilterStatus() {
  return {
    enabled: true,
    policy: "high-confidence-ad-only",
    defaultAction: "allow",
    firstPartyPolicy: "always-allow",
    dnsFallback: false,
    safariRules: buildSafariContentBlockerRules().length,
    blockedDomains: AD_ONLY_HOSTS.size,
    supportedPlanes: ["api-classifier", "safari-content-blocker", "zero-cost-safari-bookmarklet"],
    unsupportedPromise: "Universal arbitrary-iOS-app ad interception is not claimed without an Apple-supported filtering extension."
  };
}
