import express from 'express';
import crypto from 'node:crypto';

const POLYGON_CHAIN_ID = 137;
const POLYGON_CHAIN_HEX = '0x89';
const USDC_POLYGON = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const PRICE_USDC = 25_000_000n; // USDC has 6 decimals.
const MIN_CONFIRMATIONS = Math.max(1, Math.min(256, Number(process.env.APEX_USDC_MIN_CONFIRMATIONS || 12)));

const clean = (value, max = 256) => String(value ?? '').trim().slice(0, max);
const isAddress = value => /^0x[a-fA-F0-9]{40}$/.test(String(value || ''));
const isTxHash = value => /^0x[a-fA-F0-9]{64}$/.test(String(value || ''));
const topicAddress = address => '0x' + String(address).slice(2).toLowerCase().padStart(64, '0');

function config() {
  const rpcUrl = clean(process.env.POLYGON_RPC_URL, 2048);
  const merchant = clean(process.env.APEX_USDC_MERCHANT_ADDRESS, 64);
  const contract = clean(process.env.POLYGON_USDC_CONTRACT_ADDRESS || USDC_POLYGON, 64);
  const chainId = Number(process.env.APEX_USDC_CHAIN_ID || POLYGON_CHAIN_ID);
  let validRpc = false;
  try { const url = new URL(rpcUrl); validRpc = ['https:', 'http:'].includes(url.protocol) && Boolean(url.hostname); } catch {}
  return {
    rpcUrl,
    merchant,
    contract,
    chainId,
    configured: validRpc && isAddress(merchant) && isAddress(contract) && contract.toLowerCase() === USDC_POLYGON.toLowerCase() && chainId === POLYGON_CHAIN_ID
  };
}

async function rpc(method, params = []) {
  const cfg = config();
  if (!cfg.configured) throw new Error('Polygon USDC payments are not configured');
  const response = await fetch(cfg.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }),
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error('Polygon RPC unavailable');
  const payload = await response.json();
  if (payload.error || !Object.prototype.hasOwnProperty.call(payload, 'result')) throw new Error('Polygon RPC did not return a valid result');
  return payload.result;
}

function transferValue(receipt, cfg) {
  let total = 0n;
  for (const log of receipt.logs || []) {
    if (String(log.address || '').toLowerCase() !== cfg.contract.toLowerCase()) continue;
    if (String(log.topics?.[0] || '').toLowerCase() !== TRANSFER_TOPIC) continue;
    if (String(log.topics?.[2] || '').toLowerCase() !== topicAddress(cfg.merchant).toLowerCase()) continue;
    try { total += BigInt(log.data); } catch {}
  }
  return total;
}

export function createPolygonUsdcRouter({ store, durableWorkerEnabled, enqueueWorkerTask, getWorkerTask }) {
  const router = express.Router();

  const remoteStoreReady = () => Boolean(store && store.remoteMode === true && String(process.env.APEX_CAS_REMOTE_ENABLED || '').toLowerCase() === 'true');

  router.get('/config', (_req, res) => {
    const cfg = config();
    return res.json({
      configured: cfg.configured && remoteStoreReady(),
      chainId: POLYGON_CHAIN_ID,
      network: 'Polygon mainnet',
      token: 'USDC',
      tokenContract: cfg.contract,
      merchantAddress: isAddress(cfg.merchant) ? cfg.merchant : null,
      priceUsdc: '25.00',
      confirmationsRequired: MIN_CONFIRMATIONS,
      storage: 'remote-content-addressed-store',
      localStorageUsed: false
    });
  });

  router.post('/intent', async (req, res) => {
    try {
      const cfg = config();
      if (!cfg.configured || !remoteStoreReady()) return res.status(503).json({ success: false, error: 'USDC checkout is not configured for remote-only storage' });
      if (!durableWorkerEnabled()) return res.status(503).json({ success: false, error: 'Order fulfillment is unavailable' });
      const name = clean(req.body?.name, 120);
      const type = clean(req.body?.type, 160);
      const brief = clean(req.body?.brief, 4000);
      const platform = clean(req.body?.platform || 'Other', 80);
      const email = clean(req.body?.email, 320).toLowerCase();
      if (!name || !type || !brief || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ success: false, error: 'name, type, brief and a valid email are required' });
      }
      // Prove this RPC is actually connected to Polygon mainnet before issuing a payable intent.
      const chain = await rpc('eth_chainId');
      if (String(chain).toLowerCase() !== POLYGON_CHAIN_HEX) return res.status(503).json({ success: false, error: 'Configured RPC is not Polygon mainnet' });
      const orderId = crypto.randomUUID();
      const intent = {
        recordType: 'rapid-usdc-intent',
        orderId, name, type, brief, platform, email,
        amountBaseUnits: PRICE_USDC.toString(),
        tokenContract: cfg.contract,
        merchantAddress: cfg.merchant,
        chainId: POLYGON_CHAIN_ID,
        status: 'payment_required',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      };
      await store.put('rapid_usdc_intents', orderId, intent);
      return res.status(201).json({
        success: true, orderId, status: 'payment_required',
        amount: '25.00', currency: 'USDC', network: 'Polygon',
        chainId: POLYGON_CHAIN_ID, tokenContract: cfg.contract,
        merchantAddress: cfg.merchant, confirmationsRequired: MIN_CONFIRMATIONS,
        expiresAt: intent.expiresAt,
        instructions: 'Send exactly 25 USDC on Polygon mainnet, then submit the transaction hash to verify.'
      });
    } catch (error) {
      console.error('[rapid-usdc-intent]', error);
      return res.status(503).json({ success: false, error: 'Could not create a remote-only USDC payment intent' });
    }
  });

  router.post('/verify', async (req, res) => {
    try {
      const cfg = config();
      if (!cfg.configured || !remoteStoreReady()) return res.status(503).json({ success: false, error: 'USDC verification requires remote-only storage and Polygon configuration' });
      if (!durableWorkerEnabled()) return res.status(503).json({ success: false, error: 'Order fulfillment is unavailable' });
      const orderId = clean(req.body?.orderId, 64);
      const txHash = clean(req.body?.txHash, 66);
      if (!/^[a-fA-F0-9-]{36}$/.test(orderId) || !isTxHash(txHash)) return res.status(400).json({ success: false, error: 'A valid orderId and transaction hash are required' });
      const intent = await store.get('rapid_usdc_intents', orderId);
      if (!intent || intent.recordType !== 'rapid-usdc-intent') return res.status(404).json({ success: false, error: 'Payment intent not found' });
      if (Date.parse(intent.expiresAt) < Date.now()) return res.status(410).json({ success: false, error: 'Payment intent expired' });
      if (intent.status === 'paid') return res.json({ success: true, duplicate: true, orderId, status: 'paid' });

      const txKey = txHash.toLowerCase();
      const used = await store.get('rapid_usdc_transactions', txKey);
      if (used && used.orderId !== orderId) return res.status(409).json({ success: false, error: 'Transaction hash has already been used for another order' });

      const receipt = await rpc('eth_getTransactionReceipt', [txHash]);
      if (!receipt) return res.status(202).json({ success: false, status: 'pending', error: 'Transaction is not confirmed yet' });
      if (Number(BigInt(receipt.status || '0x0')) !== 1) return res.status(400).json({ success: false, status: 'failed', error: 'On-chain transaction failed' });
      if (String(receipt.to || '').toLowerCase() === cfg.contract.toLowerCase()) {
        // ERC-20 transfers must be validated from the token's Transfer logs, not only receipt.to.
      }
      const chain = await rpc('eth_chainId');
      if (String(chain).toLowerCase() !== POLYGON_CHAIN_HEX) return res.status(503).json({ success: false, error: 'RPC chain mismatch' });
      const head = BigInt(await rpc('eth_blockNumber'));
      const block = BigInt(receipt.blockNumber || '0x0');
      const confirmations = Number(head >= block ? head - block + 1n : 0n);
      if (confirmations < MIN_CONFIRMATIONS) return res.status(202).json({ success: false, status: 'confirming', confirmations, required: MIN_CONFIRMATIONS });
      const amount = transferValue(receipt, cfg);
      if (amount < PRICE_USDC) return res.status(400).json({ success: false, status: 'insufficient_funds', receivedBaseUnits: amount.toString(), requiredBaseUnits: PRICE_USDC.toString() });
      if (!durableWorkerEnabled()) return res.status(503).json({ success: false, error: 'Order fulfillment is unavailable' });

      const existingTask = await getWorkerTask(orderId);
      if (existingTask) {
        if (existingTask.task !== 'rapid-video-order' || existingTask.payload?.usdcTxHash?.toLowerCase() !== txKey) {
          return res.status(409).json({ success: false, error: 'Order ID is already associated with another payment' });
        }
        return res.json({ success: true, duplicate: true, orderId, status: existingTask.status });
      }

      // Reserve a transaction hash under the shared remote-store mutation lock.
      // A concurrent request cannot spend the same on-chain payment for a second order.
      const reservation = await store.withMutationLock(async () => {
        const current = await store.get('rapid_usdc_transactions', txKey);
        if (current && current.orderId !== orderId) return false;
        if (!current) await store.put('rapid_usdc_transactions', txKey, {
          recordType: 'rapid-usdc-transaction', txHash: txKey, orderId,
          status: 'processing', chainId: POLYGON_CHAIN_ID,
          tokenContract: cfg.contract, reservedAt: new Date().toISOString()
        });
        return true;
      });
      if (!reservation) return res.status(409).json({ success: false, error: 'Transaction hash has already been used for another order' });

      await enqueueWorkerTask({
        id: orderId, workerId: 'rapid-video-intake', role: 'rapid-video',
        task: 'rapid-video-order',
        payload: {
          orderId, name: intent.name, type: intent.type, brief: intent.brief,
          platform: intent.platform, email: intent.email, price: 25, netTarget: 25,
          paid: true, paymentMethod: 'usdc-polygon', usdcTxHash: txKey,
          tokenContract: cfg.contract, chainId: POLYGON_CHAIN_ID,
          amountReceivedBaseUnits: amount.toString(), paidAt: new Date().toISOString()
        },
        maxAttempts: 3, dedupeKey: 'rapid-paid:' + orderId, traceId: orderId
      });
      await store.put('rapid_usdc_transactions', txKey, {
        recordType: 'rapid-usdc-transaction', txHash: txKey, orderId,
        amountBaseUnits: amount.toString(), blockNumber: Number(block), status: 'verified',
        confirmations, chainId: POLYGON_CHAIN_ID, tokenContract: cfg.contract,
        verifiedAt: new Date().toISOString()
      });
      await store.put('rapid_usdc_intents', orderId, { ...intent, status: 'paid', txHash: txKey, paidAt: new Date().toISOString() });
      return res.json({ success: true, status: 'paid', orderId, txHash: txKey, amountReceived: (Number(amount) / 1_000_000).toFixed(6), confirmations });
    } catch (error) {
      console.error('[rapid-usdc-verify]', error);
      return res.status(503).json({ success: false, error: 'USDC verification temporarily unavailable' });
    }
  });

  return router;
}
