import test from "node:test";
import assert from "node:assert/strict";
import { createPolygonUsdcListener, NATIVE_USDC_POLYGON } from "../src/core/polygon-usdc-listener.mjs";

const recipient = "0x1111111111111111111111111111111111111111";
const sender = "0x2222222222222222222222222222222222222222";
const topicAddress = address => "0x" + address.slice(2).toLowerCase().padStart(64, "0");
const hex = value => "0x" + BigInt(value).toString(16);
const transfer = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function setup({ chainId = 137, logs = [] } = {}) {
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    const req = JSON.parse(options.body);
    let result;
    if (req.method === "eth_chainId") result = hex(chainId);
    else if (req.method === "eth_getCode") result = "0x6001";
    else if (req.method === "eth_blockNumber") result = hex(500);
    else if (req.method === "eth_getLogs") result = logs.filter(log =>
      Number(BigInt(log.blockNumber)) >= Number(BigInt(req.params[0].fromBlock)) &&
      Number(BigInt(log.blockNumber)) <= Number(BigInt(req.params[0].toBlock)));
    else throw new Error("unexpected RPC method " + req.method);
    calls.push(req.method);
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
  };
  const cursor = { value: null, async get() { return this.value; }, async set(_key, value) { this.value = value; } };
  const tasks = [];
  const listener = createPolygonUsdcListener({
    rpcUrl: "https://polygon-rpc.example",
    recipient,
    confirmations: 10,
    lookbackBlocks: 100,
    cursorStore: cursor,
    enqueue: async task => { tasks.push(task); },
    now: () => 0
  });
  return { listener, cursor, tasks, calls };
}

test("refuses an RPC endpoint on a non-Polygon-mainnet chain", async () => {
  const { listener } = setup({ chainId: 80002 });
  await assert.rejects(() => listener.scanOnce(), /chain ID is not Polygon PoS mainnet/);
});

test("enqueues only matching confirmed native-USDC transfers with an idempotency key", async () => {
  const good = {
    address: NATIVE_USDC_POLYGON,
    topics: [transfer, topicAddress(sender), topicAddress(recipient)],
    data: "0x" + BigInt(2500000).toString(16).padStart(64, "0"),
    blockNumber: hex(480),
    transactionHash: "0x" + "a".repeat(64),
    logIndex: hex(3)
  };
  const wrongRecipient = { ...good, topics: [transfer, topicAddress(sender), topicAddress("0x3333333333333333333333333333333333333333")] };
  const { listener, tasks, cursor } = setup({ logs: [good, wrongRecipient] });
  const result = await listener.scanOnce();
  assert.equal(result.enqueued, 1);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].priority, 0);
  assert.equal(tasks[0].payload.rawAmount, "2500000");
  assert.equal(tasks[0].payload.tokenDecimals, 6);
  assert.match(tasks[0].dedupeKey, /polygon-pos-usdc:/);
  assert.equal(cursor.value, 491);
});

test("requires durable cursor and enqueue contracts", () => {
  assert.throws(() => createPolygonUsdcListener({
    rpcUrl: "https://rpc.example", recipient, enqueue: async () => {}
  }), /durable atomic cursorStore/);
});
