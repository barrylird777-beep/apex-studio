import crypto from "node:crypto";

const text = (value, max = 256) => String(value ?? "").trim().slice(0, max);
const numberOrNull = value => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export function opportunityEngineTokenMatches(expected, supplied) {
  if (!expected || !supplied) return false;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(supplied));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function normalizeOpportunity(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Opportunity payload must be an object");
  }
  const fingerprint = text(input.fingerprint);
  if (!fingerprint) throw new TypeError("Opportunity fingerprint is required");
  const id = "opportunity-" + crypto.createHash("sha256").update(fingerprint).digest("hex");
  const observedAt = text(input.observed_at || input.observedAt, 80) || new Date().toISOString();
  return {
    id,
    record: {
      recordType: "opportunity",
      fingerprint,
      kind: text(input.kind || "opportunity", 64),
      chain_id: numberOrNull(input.chain_id ?? input.chainId),
      token_in: text(input.token_in ?? input.tokenIn, 256),
      token_out: text(input.token_out ?? input.tokenOut, 256),
      buy_pool: text(input.buy_pool ?? input.buyPool, 256),
      sell_pool: text(input.sell_pool ?? input.sellPool, 256),
      gross_edge_bps: numberOrNull(input.gross_edge_bps ?? input.grossEdgeBps),
      estimated_gas_usd: numberOrNull(input.estimated_gas_usd ?? input.estimatedGasUsd),
      estimated_slippage_usd: numberOrNull(input.estimated_slippage_usd ?? input.estimatedSlippageUsd),
      estimated_net_profit_usd: numberOrNull(input.estimated_net_profit_usd ?? input.estimatedNetProfitUsd),
      observed_at: observedAt,
      payload: structuredClone(input)
    }
  };
}

export async function saveKashKornerOpportunity(fabric, input) {
  const { id, record } = normalizeOpportunity(input);
  return fabric.put("kash-korner", id, record);
}

export async function listKashKornerOpportunities(fabric, limit = 100) {
  const rows = await fabric.list("kash-korner");
  return rows
    .map(row => row?.record || row)
    .filter(record => record?.recordType === "opportunity" && record.fingerprint)
    .sort((a, b) => (numberOrNull(b.estimated_net_profit_usd) ?? -Infinity) - (numberOrNull(a.estimated_net_profit_usd) ?? -Infinity)
      || String(b.observed_at || "").localeCompare(String(a.observed_at || "")))
    .slice(0, Math.max(1, Math.min(500, Number(limit) || 100)));
}
