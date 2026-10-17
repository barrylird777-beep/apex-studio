import { createHash } from "node:crypto";

export const POLYGON_POS_CHAIN_ID = 137;
export const NATIVE_USDC_POLYGON = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function hexNumber(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) throw new Error("Invalid JSON-RPC hex quantity");
  return Number(BigInt(value));
}
function addressTopic(address) {
  const value = String(address || "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(value)) throw new Error("A valid Polygon recipient address is required");
  return "0x" + value.slice(2).padStart(64, "0");
}
function addressFromTopic(topic) {
  if (typeof topic !== "string" || !/^0x[0-9a-f]{64}$/i.test(topic)) throw new Error("Malformed ERC-20 address topic");
  return "0x" + topic.slice(-40).toLowerCase();
}
function quantity(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value)) throw new Error("Malformed USDC Transfer amount");
  return BigInt(value);
}
async function rpc(url, method, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error("Polygon RPC HTTP " + response.status);
  const body = await response.json();
  if (body.error) throw new Error("Polygon RPC request failed");
  return body.result;
}

/**
 * Mainnet-only USDC event scanner. cursorStore must be durable, shared, and
 * atomic; enqueue must enforce durable idempotency on dedupeKey.
 */
export function createPolygonUsdcListener({
  rpcUrl = process.env.POLYGON_POS_RPC_URL,
  recipient = process.env.APEX_USDC_RECIPIENT,
  confirmations = Number(process.env.APEX_USDC_CONFIRMATIONS || 128),
  lookbackBlocks = Number(process.env.APEX_USDC_LOOKBACK_BLOCKS || 2000),
  cursorStore,
  enqueue,
  now = () => Date.now()
} = {}) {
  if (!rpcUrl || !/^https:\/\//i.test(rpcUrl)) throw new Error("POLYGON_POS_RPC_URL must be an HTTPS mainnet RPC URL");
  const toTopic = addressTopic(recipient);
  if (!Number.isInteger(confirmations) || confirmations < 1) throw new Error("USDC confirmation depth must be positive");
  if (!Number.isInteger(lookbackBlocks) || lookbackBlocks < confirmations) throw new Error("USDC lookback must be at least the confirmation depth");
  if (!cursorStore || typeof cursorStore.get !== "function" || typeof cursorStore.set !== "function") throw new Error("A durable atomic cursorStore is required");
  if (typeof enqueue !== "function") throw new Error("A durable idempotent enqueue function is required");

  async function assertMainnet() {
    const chainId = hexNumber(await rpc(rpcUrl, "eth_chainId", []));
    if (chainId !== POLYGON_POS_CHAIN_ID) throw new Error("Refusing payment scan: RPC chain ID is not Polygon PoS mainnet (137)");
    const code = await rpc(rpcUrl, "eth_getCode", [NATIVE_USDC_POLYGON, "latest"]);
    if (typeof code !== "string" || code === "0x") throw new Error("Native USDC contract code is unavailable on this RPC");
  }

  async function scanOnce() {
    await assertMainnet();
    const head = hexNumber(await rpc(rpcUrl, "eth_blockNumber", []));
    const safeHead = head - confirmations + 1;
    if (safeHead < 0) return { scanned: 0, enqueued: 0, safeHead };
    const stored = await cursorStore.get("polygon-pos-usdc-v1");
    const fromBlock = stored == null ? Math.max(0, safeHead - lookbackBlocks + 1) : Number(stored) + 1;
    if (!Number.isSafeInteger(fromBlock) || fromBlock < 0) throw new Error("Invalid durable USDC scan cursor");
    if (fromBlock > safeHead) return { scanned: 0, enqueued: 0, safeHead };
    let enqueued = 0;
    for (let start = fromBlock; start <= safeHead; start += 1000) {
      const end = Math.min(safeHead, start + 999);
      const logs = await rpc(rpcUrl, "eth_getLogs", [{
        address: NATIVE_USDC_POLYGON,
        fromBlock: "0x" + start.toString(16),
        toBlock: "0x" + end.toString(16),
        topics: [TRANSFER_TOPIC, null, toTopic]
      }]);
      if (!Array.isArray(logs)) throw new Error("Malformed Polygon log response");
      for (const log of logs) {
        if (String(log.address).toLowerCase() !== NATIVE_USDC_POLYGON.toLowerCase()) continue;
        if (!Array.isArray(log.topics) || log.topics.length < 3 || String(log.topics[0]).toLowerCase() !== TRANSFER_TOPIC) continue;
        if (addressFromTopic(log.topics[2]) !== String(recipient).toLowerCase()) continue;
        const blockNumber = hexNumber(log.blockNumber);
        if (blockNumber > safeHead) continue;
        const txHash = String(log.transactionHash || "").toLowerCase();
        const logIndex = hexNumber(log.logIndex);
        if (!/^0x[0-9a-f]{64}$/.test(txHash)) throw new Error("Malformed Polygon transaction hash");
        const rawAmount = quantity(log.data);
        if (rawAmount <= 0n) continue;
        const dedupeKey = "polygon-pos-usdc:" + txHash + ":" + logIndex;
        const paymentId = createHash("sha256").update(dedupeKey).digest("hex");
        await enqueue({
          id: paymentId,
          task: "paid_inference_payment",
          priority: 0,
          dedupeKey,
          payload: {
            chainId: POLYGON_POS_CHAIN_ID,
            token: NATIVE_USDC_POLYGON,
            recipient: String(recipient).toLowerCase(),
            sender: addressFromTopic(log.topics[1]),
            txHash,
            logIndex,
            blockNumber,
            rawAmount: rawAmount.toString(),
            tokenDecimals: 6,
            observedAt: new Date(now()).toISOString()
          }
        });
        enqueued++;
      }
      // Advance only after every log in the range was successfully enqueued.
      await cursorStore.set("polygon-pos-usdc-v1", end);
    }
    return { scanned: safeHead - fromBlock + 1, enqueued, safeHead };
  }

  return { scanOnce };
}
