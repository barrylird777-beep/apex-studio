import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { createPolygonUsdcRouter } from '../src/routes/usdc-polygon.mjs';

const MERCHANT = '0x1111111111111111111111111111111111111111';
const TOKEN = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const txHash = '0x' + 'a'.repeat(64);
const topicAddress = address => '0x' + address.slice(2).toLowerCase().padStart(64, '0');

async function withServer({ store, tasks, rpcHandler, enabled = true }, run) {
  const previous = {
    remote: process.env.APEX_CAS_REMOTE_ENABLED,
    rpc: process.env.POLYGON_RPC_URL,
    merchant: process.env.APEX_USDC_MERCHANT_ADDRESS,
    chain: process.env.APEX_USDC_CHAIN_ID
  };
  process.env.APEX_CAS_REMOTE_ENABLED = 'true';
  process.env.POLYGON_RPC_URL = 'https://polygon-rpc.example';
  process.env.APEX_USDC_MERCHANT_ADDRESS = MERCHANT;
  process.env.APEX_USDC_CHAIN_ID = '137';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const result = await rpcHandler(request.method, request.params);
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: request.id, result }) };
  };
  const app = express();
  app.use(express.json());
  app.use('/api/rapid/usdc', createPolygonUsdcRouter({
    store,
    durableWorkerEnabled: () => enabled,
    enqueueWorkerTask: async task => { tasks.set(task.id, task); return { id: task.id }; },
    getWorkerTask: async id => tasks.get(id) || null
  }));
  const server = http.createServer(app);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try { await run('http://127.0.0.1:' + server.address().port); }
  finally {
    await new Promise(resolve => server.close(resolve));
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries({ APEX_CAS_REMOTE_ENABLED: previous.remote, POLYGON_RPC_URL: previous.rpc, APEX_USDC_MERCHANT_ADDRESS: previous.merchant, APEX_USDC_CHAIN_ID: previous.chain })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

function memoryRemoteStore() {
  const records = new Map();
  return {
    remoteMode: true,
    async init() {},
    async get(collection, id) { return records.get(collection + ':' + id) || null; },
    async put(collection, id, value) {
      const record = { ...value, id, updatedAt: new Date().toISOString() };
      records.set(collection + ':' + id, record);
      return record;
    },
    async withMutationLock(fn) { return fn(); }
  };
}

function rpcFixture() {
  return async (method) => {
    if (method === 'eth_chainId') return '0x89';
    if (method === 'eth_blockNumber') return '0x80';
    if (method === 'eth_getTransactionReceipt') return {
      status: '0x1', blockNumber: '0x64', to: TOKEN,
      logs: [{
        address: TOKEN, topics: [TRANSFER, topicAddress('0x2222222222222222222222222222222222222222'), topicAddress(MERCHANT)],
        data: '0x' + (25_000_000n).toString(16)
      }]
    };
    throw new Error('Unexpected RPC method: ' + method);
  };
}

test('USDC checkout creates a remote-only $25 Polygon intent and queues only a confirmed matching transfer', async () => {
  const store = memoryRemoteStore();
  const tasks = new Map();
  await withServer({ store, tasks, rpcHandler: rpcFixture() }, async base => {
    const intentResponse = await fetch(base + '/api/rapid/usdc/intent', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Buyer', type: 'Spec ad', brief: 'Make a product ad', platform: 'Other', email: 'buyer@example.com' })
    });
    assert.equal(intentResponse.status, 201);
    const intent = await intentResponse.json();
    assert.equal(intent.amount, '25.00');
    assert.equal(intent.currency, 'USDC');
    assert.equal(intent.chainId, 137);
    assert.equal(intent.merchantAddress, MERCHANT);

    const verifyResponse = await fetch(base + '/api/rapid/usdc/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: intent.orderId, txHash })
    });
    assert.equal(verifyResponse.status, 200);
    const verified = await verifyResponse.json();
    assert.equal(verified.status, 'paid');
    assert.equal(verified.amountReceived, '25.000000');
    assert.equal(tasks.size, 1);
    assert.equal([...tasks.values()][0].payload.paymentMethod, 'usdc-polygon');
    assert.equal((await store.get('rapid_usdc_intents', intent.orderId)).status, 'paid');
    assert.equal((await store.get('rapid_usdc_transactions', txHash)).status, undefined);
  });
});

test('USDC checkout fails closed when the store is local instead of remote-only', async () => {
  const store = memoryRemoteStore();
  store.remoteMode = false;
  await withServer({ store, tasks: new Map(), rpcHandler: rpcFixture() }, async base => {
    const response = await fetch(base + '/api/rapid/usdc/intent', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Buyer', type: 'Spec ad', brief: 'Make a product ad', email: 'buyer@example.com' })
    });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /remote-only storage/i);
  });
});

test('USDC verifier rejects insufficient token transfer amounts', async () => {
  const store = memoryRemoteStore();
  const tasks = new Map();
  const fixture = async (method, params) => {
    if (method === 'eth_chainId') return '0x89';
    if (method === 'eth_blockNumber') return '0x80';
    if (method === 'eth_getTransactionReceipt') return {
      status: '0x1', blockNumber: '0x64',
      logs: [{
        address: TOKEN, topics: [TRANSFER, topicAddress('0x2222222222222222222222222222222222222222'), topicAddress(MERCHANT)],
        data: '0x' + (24_000_000n).toString(16)
      }]
    };
  };
  await withServer({ store, tasks, rpcHandler: fixture }, async base => {
    const intentResponse = await fetch(base + '/api/rapid/usdc/intent', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Buyer', type: 'Spec ad', brief: 'Make a product ad', email: 'buyer@example.com' })
    });
    const intent = await intentResponse.json();
    const response = await fetch(base + '/api/rapid/usdc/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: intent.orderId, txHash })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).status, 'insufficient_funds');
    assert.equal(tasks.size, 0);
  });
});
