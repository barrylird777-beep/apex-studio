const configured = (url, token) => ({ url: String(url || "").trim(), token: String(token || "").trim() });

export async function triggerOpportunityScan({
  url = process.env.APEX_OPPORTUNITY_ENGINE_SCAN_URL,
  token = process.env.APEX_OPPORTUNITY_ENGINE_SCAN_TOKEN,
  fetchImpl = fetch,
  timeoutMs = 120000
} = {}) {
  const config = configured(url, token);
  if (!config.url && !config.token) return { skipped: true, reason: "not-configured" };
  if (!config.url || !config.token) throw new Error("Opportunity Engine scan URL and token must both be configured");
  const response = await fetchImpl(config.url, {
    method: "POST",
    headers: {
      "x-apex-opportunity-token": config.token,
      authorization: "Bearer " + config.token,
      accept: "application/json"
    },
    signal: AbortSignal.timeout(Math.max(1000, Number(timeoutMs) || 120000))
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Opportunity Engine scan returned HTTP " + response.status);
  return { ok: true, status: response.status, scanner: body };
}

export function startOpportunityEngineScanScheduler({
  url = process.env.APEX_OPPORTUNITY_ENGINE_SCAN_URL,
  token = process.env.APEX_OPPORTUNITY_ENGINE_SCAN_TOKEN,
  intervalMs = process.env.APEX_OPPORTUNITY_ENGINE_SCAN_INTERVAL_MS,
  fetchImpl = fetch,
  logger = console,
  runImmediately = true
} = {}) {
  const config = configured(url, token);
  if (!config.url && !config.token) return { enabled: false, stop() {} };
  if (!config.url || !config.token) throw new Error("Opportunity Engine scan URL and token must both be configured");
  let stopped = false;
  let busy = false;
  const run = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      const result = await triggerOpportunityScan({ url: config.url, token: config.token, fetchImpl });
      logger.info("[apex-worker] Opportunity Engine scan completed", result.status);
    } catch (error) {
      logger.error("[apex-worker] Opportunity Engine scan failed:", error?.message || error);
    } finally {
      busy = false;
    }
  };
  const everyMs = Math.max(60000, Number(intervalMs) || 300000);
  const timer = setInterval(() => { void run(); }, everyMs);
  timer.unref?.();
  if (runImmediately) void run();
  return { enabled: true, intervalMs: everyMs, stop() { stopped = true; clearInterval(timer); } };
}
