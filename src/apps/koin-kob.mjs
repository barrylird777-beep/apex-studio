import crypto from "node:crypto";
import { getApexApp } from "./apex-six-apps.mjs";

const APP = getApexApp("koin-kob");
const n = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const uid = () => crypto.randomUUID();
const clone = value => structuredClone(value);
const workerIdOf = value => String(value ?? '').trim().slice(0, 256);

export function createWorkerAccount(input = {}) {
  return {
    workerId: String(input.workerId || uid()),
    balance: Math.max(0, n(input.balance)),
    reputation: Math.max(0, n(input.reputation)),
    skills: Array.isArray(input.skills) ? [...new Set(input.skills.map(String))] : [],
    inventory: input.inventory && typeof input.inventory === "object" && !Array.isArray(input.inventory) ? clone(input.inventory) : {},
    needs: Array.isArray(input.needs) ? [...new Set(input.needs.map(String))] : []
  };
}

export function createMarketOrder(input = {}) {
  const side = String(input.side || "buy");
  if (!["buy", "sell"].includes(side)) throw new Error("Market order side must be buy or sell");
  const quantity = n(input.quantity);
  const price = n(input.price);
  if (quantity <= 0 || price < 0) throw new Error("Market order quantity/price is invalid");
  return {
    id: uid(),
    workerId: String(input.workerId || ""),
    side,
    asset: String(input.asset || "service"),
    quantity,
    price,
    createdAt: new Date().toISOString()
  };
}

export function clearMarket(orders = []) {
  const byAsset = new Map();
  for (const raw of Array.isArray(orders) ? orders : []) {
    if (!raw || !["buy", "sell"].includes(raw.side)) continue;
    const order = { ...raw, quantity: n(raw.quantity), price: n(raw.price), asset: String(raw.asset || "service") };
    if (!order.workerId || order.quantity <= 0 || order.price < 0) continue;
    if (!byAsset.has(order.asset)) byAsset.set(order.asset, { buys: [], sells: [] });
    byAsset.get(order.asset)[order.side === "buy" ? "buys" : "sells"].push(order);
  }
  const trades = [];
  const unfilledBuys = [];
  const unfilledSells = [];
  for (const [asset, book] of byAsset) {
    book.buys.sort((a, b) => b.price - a.price || String(a.id).localeCompare(String(b.id)));
    book.sells.sort((a, b) => a.price - b.price || String(a.id).localeCompare(String(b.id)));
    let i = 0, j = 0;
    while (i < book.buys.length && j < book.sells.length && book.buys[i].price >= book.sells[j].price) {
      const quantity = Math.min(book.buys[i].quantity, book.sells[j].quantity);
      const price = (book.buys[i].price + book.sells[j].price) / 2;
      trades.push({
        id: uid(),
        asset,
        quantity,
        price,
        buyer: book.buys[i].workerId,
        seller: book.sells[j].workerId,
        createdAt: new Date().toISOString()
      });
      book.buys[i].quantity -= quantity;
      book.sells[j].quantity -= quantity;
      if (book.buys[i].quantity <= 0) i++;
      if (book.sells[j].quantity <= 0) j++;
    }
    unfilledBuys.push(...book.buys.filter(order => order.quantity > 0));
    unfilledSells.push(...book.sells.filter(order => order.quantity > 0));
  }
  return { trades, unfilledBuys, unfilledSells };
}

export function settleMarket(accounts = [], market = { trades: [] }) {
  const byId = new Map((Array.isArray(accounts) ? accounts : []).map(account => [account.workerId, clone(account)]));
  const settled = [];
  const rejected = [];
  for (const trade of Array.isArray(market.trades) ? market.trades : []) {
    const buyer = byId.get(trade.buyer);
    const seller = byId.get(trade.seller);
    const quantity = n(trade.quantity);
    const price = n(trade.price);
    const total = quantity * price;
    if (!buyer || !seller || buyer.workerId === seller.workerId || quantity <= 0 || price < 0 || buyer.balance < total) {
      rejected.push({ ...trade, reason: buyer?.workerId === seller?.workerId ? "self-trade" : "insufficient-account-state" });
      continue;
    }
    const inventory = Math.max(0, n(seller.inventory?.[trade.asset]));
    if (inventory < quantity) {
      rejected.push({ ...trade, reason: "insufficient-inventory" });
      continue;
    }
    buyer.balance -= total;
    seller.balance += total;
    seller.inventory[trade.asset] = inventory - quantity;
    buyer.inventory[trade.asset] = Math.max(0, n(buyer.inventory?.[trade.asset])) + quantity;
    settled.push({ ...trade, total });
  }
  return { accounts: [...byId.values()], settled, rejected };
}

export function createSystemicEvent(input = {}) {
  return {
    id: uid(),
    type: String(input.type || "resource-shortage"),
    severity: Math.max(0, Math.min(1, n(input.severity, 0.5))),
    target: String(input.target || "global"),
    payload: input.payload && typeof input.payload === "object" && !Array.isArray(input.payload) ? clone(input.payload) : {},
    createdAt: new Date().toISOString()
  };
}

function applyEvents(orders, events) {
  let next = (Array.isArray(orders) ? orders : []).map(order => ({ ...order }));
  const matrix = [];
  for (const event of Array.isArray(events) ? events : []) {
    const severity = Math.max(0, Math.min(1, n(event.severity, 0.5)));
    const target = String(event.target || "global");
    const type = String(event.type || "resource-shortage");
    if (type === "resource-shortage" || type === "supplier-failure" || type === "infrastructure-breakdown") {
      next = next.filter(order => !(order.side === "sell" && (target === "global" || order.asset === target)));
    } else if (type === "demand-spike") {
      next = next.map(order => order.side === "buy" && (target === "global" || order.asset === target)
        ? { ...order, price: order.price * (1 + severity) }
        : order);
    } else if (type === "market-crash") {
      next = next.map(order => ({ ...order, price: order.price * Math.max(0, 1 - severity) }));
    } else if (type === "technology-introduction") {
      next = next.map(order => order.side === "sell" && (target === "global" || order.asset === target)
        ? { ...order, price: order.price * Math.max(0.1, 1 - severity * 0.5) }
        : order);
    }
    matrix.push({ eventId: event.id, type, target, severity, remainingOrders: next.length });
  }
  return { orders: next, matrix };
}

export function runAdversarialRound({ workers = [], orders = [], events = [] } = {}) {
  const applied = applyEvents(orders, events);
  const market = clearMarket(applied.orders);
  return {
    roundId: uid(),
    workerCount: Array.isArray(workers) ? workers.length : 0,
    eventCount: Array.isArray(events) ? events.length : 0,
    trades: market.trades.length,
    volume: market.trades.reduce((sum, trade) => sum + trade.quantity * trade.price, 0),
    unfilledBuys: market.unfilledBuys.length,
    unfilledSells: market.unfilledSells.length,
    eventMatrix: applied.matrix,
    generatedAt: new Date().toISOString()
  };
}

export function buildWorkerEconomy({
  workerCount = 2000,
  factions = ["north", "south", "east", "west"],
  governanceModels = ["market", "cooperative", "centralized", "mixed"]
} = {}) {
  const count = Math.max(1, Math.floor(n(workerCount, 2000)));
  const fs = Array.isArray(factions) && factions.length ? factions.map(String) : ["world"];
  const gs = Array.isArray(governanceModels) && governanceModels.length ? governanceModels.map(String) : ["market"];
  const workers = Array.from({ length: count }, (_, index) => createWorkerAccount({
    workerId: "worker-" + String(index + 1).padStart(4, "0"),
    skills: [["story", "visual", "audio", "research", "engineering", "commerce"][index % 6]],
    balance: 100,
    reputation: 50
  }));
  return {
    id: uid(),
    workerCount: count,
    factions: fs.map((name, index) => ({
      id: "faction-" + (index + 1),
      name,
      governanceModel: gs[index % gs.length],
      workerCount: Math.floor(count / fs.length) + (index < count % fs.length ? 1 : 0)
    })),
    workers,
    createdAt: new Date().toISOString()
  };
}

export function runWorkerEconomySimulation({
  workerCount = 2000,
  factions,
  governanceModels,
  orders = [],
  events = []
} = {}) {
  const world = buildWorkerEconomy({ workerCount, factions, governanceModels });
  let generatedOrders;
  if (Array.isArray(orders) && orders.length) {
    generatedOrders = orders.map(order => ({ ...order }));
  } else {
    generatedOrders = [];
    const assets = ["service", "energy", "media", "food"];
    const count = Math.min(world.workerCount, 400);
    for (let index = 0; index < count; index++) {
      const asset = assets[index % assets.length];
      const side = index % 2 === 0 ? "buy" : "sell";
      const quantity = 1 + (index % 3);
      if (side === "sell") world.workers[index].inventory[asset] = quantity;
      generatedOrders.push(createMarketOrder({
        workerId: world.workers[index].workerId,
        side,
        asset,
        quantity,
        price: 5 + (index % 11)
      }));
    }
  }
  const result = runAdversarialRound({ workers: world.workers, orders: generatedOrders, events });
  const appliedOrders = applyEvents(generatedOrders, events).orders;
  const accounts = settleMarket(world.workers, clearMarket(appliedOrders));
  return {
    simulationId: world.id,
    workerCount: world.workerCount,
    factions: world.factions,
    eventMatrix: result.eventMatrix,
    orders: generatedOrders.length,
    ...result,
    settlement: {
      settledTrades: accounts.settled.length,
      rejectedTrades: accounts.rejected.length
    },
    marketClearRate: generatedOrders.length ? Number((result.trades * 2 / generatedOrders.length).toFixed(4)) : 0,
    researchQuestion: "Can 2,000 workers discover an efficient way to organize themselves without us explicitly programming the organization?"
  };
}

export function koinKobStatus() {
  return {
    app: { ...APP },
    role: APP.role,
    capabilities: ["worker accounts", "barter", "market orders", "market clearing", "settlement", "systemic events", "dynamic event matrix", "adversarial rounds", "2,000-worker economy simulation", "economy-driven routing"],
    canonical: true,
    checkedAt: new Date().toISOString()
  };
}
