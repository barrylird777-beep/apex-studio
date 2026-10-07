import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {buildRapidCheckoutMetadata,decodeRapidCheckoutMetadata,verifyRapidStripeSignature} from '../src/payments/stripe-rapid.mjs';

test('Rapid checkout metadata round-trips full brief',()=>{
  const brief='Line one\nLine two — cinematic hook. '.repeat(140);
  const metadata=buildRapidCheckoutMetadata({orderId:'order-1',name:'Apex',type:'Bible story',brief,platform:'TikTok'});
  assert.ok(Object.keys(metadata).length<=50);
  for(const value of Object.values(metadata)) assert.ok(String(value).length<=500);
  const decoded=decodeRapidCheckoutMetadata(metadata);
  assert.equal(decoded.orderId,'order-1');
  assert.equal(decoded.name,'Apex');
  assert.equal(decoded.type,'Bible story');
  assert.equal(decoded.platform,'TikTok');
  assert.equal(decoded.brief,brief);
});

test('Rapid Stripe signature verifies and rejects tampering',()=>{
  const secret='whsec_test';
  const payload=JSON.stringify({id:'evt_test',type:'checkout.session.completed',data:{object:{}}});
  const timestamp=Math.floor(Date.now()/1000);
  const signature=crypto.createHmac('sha256',secret).update(timestamp+'.'+payload).digest('hex');
  const event=verifyRapidStripeSignature(Buffer.from(payload),`t=${timestamp},v1=${signature}`,secret);
  assert.equal(event.id,'evt_test');
  assert.throws(()=>verifyRapidStripeSignature(Buffer.from(payload+'x'),`t=${timestamp},v1=${signature}`,secret),/Invalid Stripe signature/);
});

test('Rapid checkout module exposes payment-gate primitives',async()=>{
  const source=await import('../src/payments/stripe-rapid.mjs');
  assert.equal(typeof source.createRapidCheckout,'function');
  assert.equal(typeof source.verifyRapidStripeSignature,'function');
  assert.equal(typeof source.decodeRapidCheckoutMetadata,'function');
});
