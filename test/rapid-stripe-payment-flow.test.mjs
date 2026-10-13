import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import { createStripeRouter } from '../src/routes/stripe.mjs';
import { buildRapidCheckoutMetadata } from '../src/payments/stripe-rapid.mjs';

const WEBHOOK_SECRET = 'whsec_apex_test_only';

function signEvent(rawBody, timestamp = Math.floor(Date.now() / 1000)) {
  const digest = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(String(timestamp) + '.' + rawBody)
    .digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

function makeEvent({ orderId = 'test-order-1', paymentStatus = 'paid', amount = 2500, currency = 'usd' } = {}) {
  const metadata = buildRapidCheckoutMetadata({
    orderId,
    name: 'Smoke Buyer',
    type: 'Product launch',
    brief: 'A cinematic launch video with a strong opening hook.',
    platform: 'TikTok',
    email: 'buyer@example.com'
  });
  return {
    id: 'evt_apex_test',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_apex',
        client_reference_id: orderId,
        payment_status: paymentStatus,
        amount_total: amount,
        currency,
        metadata
      }
    }
  };
}

async function withWebhookServer(options, run) {
  const app = express();
  app.use('/api/stripe', createStripeRouter(options));
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function postEvent(baseUrl, event, signatureOverride) {
  const rawBody = JSON.stringify(event);
  return fetch(baseUrl + '/api/stripe/rapid/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signatureOverride ?? signEvent(rawBody)
    },
    body: rawBody
  });
}

test('Stripe paid checkout webhook verifies payment and queues one order exactly once', async () => {
  const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  const tasks = new Map();
  const queued = [];
  try {
    await withWebhookServer({
      durableWorkerEnabled: () => true,
      getWorkerTask: async id => tasks.get(id) ?? null,
      enqueueWorkerTask: async task => {
        queued.push(task);
        tasks.set(task.id, task);
      }
    }, async baseUrl => {
      const event = makeEvent();
      const rawBody = JSON.stringify(event);

      const invalidSignature = await postEvent(baseUrl, event, 't=1,v1=deadbeef');
      assert.equal(invalidSignature.status, 400, 'invalid signatures must not queue work');

      const unpaid = await postEvent(baseUrl, makeEvent({ paymentStatus: 'unpaid' }));
      assert.equal(unpaid.status, 400, 'unpaid checkouts must not queue work');

      const wrongAmount = await postEvent(baseUrl, makeEvent({ amount: 100 }));
      assert.equal(wrongAmount.status, 400, 'payments that do not match the $25 all-in price must not queue work');

      const response = await postEvent(baseUrl, event, signEvent(rawBody));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        received: true,
        queued: true,
        orderId: 'test-order-1'
      });

      const duplicate = await postEvent(baseUrl, event, signEvent(rawBody));
      assert.equal(duplicate.status, 200);
      assert.deepEqual(await duplicate.json(), {
        received: true,
        duplicate: true,
        orderId: 'test-order-1'
      });

      assert.equal(queued.length, 1, 'replayed webhook must not enqueue a second paid order');
      assert.equal(queued[0].id, 'test-order-1');
      assert.equal(queued[0].task, 'rapid-video-order');
      assert.equal(queued[0].payload.paid, true);
      assert.equal(queued[0].payload.price, 25);
      assert.equal(queued[0].payload.netTarget, 25);
      assert.equal(queued[0].payload.brief, 'A cinematic launch video with a strong opening hook.');
    });
  } finally {
    if (previousSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
  }
});

test('Stripe paid checkout webhook fails closed when the durable queue is unavailable', async () => {
  const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  try {
    await withWebhookServer({
      durableWorkerEnabled: () => false,
      getWorkerTask: async () => null,
      enqueueWorkerTask: async () => assert.fail('queue must not be called when disabled')
    }, async baseUrl => {
      const response = await postEvent(baseUrl, makeEvent());
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        received: false,
        error: 'Order queue unavailable'
      });
    });
  } finally {
    if (previousSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
  }
});
