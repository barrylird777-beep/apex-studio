import crypto from "node:crypto";
import { getApexApp } from "./apex-six-apps.mjs";

const APP = getApexApp("kash-korner");
const currencyOf = value => String(value || 'USD').trim().toUpperCase();
const n = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export function recordCashEntry(input = {}) {
  const amount = n(input.amount);
  if (!amount) throw new Error("Cash entry amount must be non-zero");
  const currency = currencyOf(input.currency);
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Cash entry currency must be ISO-4217 style three-letter code");
  return {
    id: String(input.id || crypto.randomUUID()),
    account: String(input.account || "apex"),
    amount,
    currency,
    kind: String(input.kind || "transaction"),
    memo: String(input.memo || ""),
    source: String(input.source || "manual"),
    createdAt: new Date().toISOString()
  };
}

export function calculateCashBalance(entries = [], currency = null) {
  const wanted = currency == null ? null : currencyOf(currency);
  return (Array.isArray(entries) ? entries : [])
    .filter(entry => !wanted || currencyOf(entry.currency) === wanted)
    .reduce((sum, entry) => sum + n(entry.amount), 0);
}

export function cashFlowSummary(entries = []) {
  const rows = Array.isArray(entries) ? entries : [];
  const currencies = new Set(rows.map(entry => currencyOf(entry.currency)));
  if (currencies.size > 1) throw new Error("Cash-flow summary requires a single currency");
  const inflow = rows.filter(entry => n(entry.amount) > 0).reduce((sum, entry) => sum + n(entry.amount), 0);
  const outflow = rows.filter(entry => n(entry.amount) < 0).reduce((sum, entry) => sum + n(entry.amount), 0);
  return {
    currency: rows.length ? currencyOf(rows[0].currency) : "USD",
    inflow,
    outflow,
    balance: inflow + outflow,
    count: rows.length
  };
}

export function kashKornerStatus() {
  return {
    app: { ...APP },
    role: APP.role,
    capabilities: ["cash ledger", "cash balance", "cash-flow summary", "financial state"],
    persistence: "caller-owned; no process-local durability claim",
    canonical: true,
    checkedAt: new Date().toISOString()
  };
}
