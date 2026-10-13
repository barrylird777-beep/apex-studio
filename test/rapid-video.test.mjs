import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {buildRapidCheckoutMetadata,buildRapidCheckoutParams,decodeRapidCheckoutMetadata,verifyRapidStripeSignature} from '../src/payments/stripe-rapid.mjs';

test('Rapid checkout metadata round-trips full brief',()=>{
  const brief='Line one\nLine two — cinematic hook. '.repeat(140);
  const metadata=buildRapidCheckoutMetadata({orderId:'order-1',name:'Apex',type:'Bible story',brief,platform:'TikTok',email:'buyer@example.com'});
  assert.ok(Object.keys(metadata).length<=50);
  for(const value of Object.values(metadata)) assert.ok(String(value).length<=500);
  const decoded=decodeRapidCheckoutMetadata(metadata);
  assert.equal(decoded.orderId,'order-1');
  assert.equal(decoded.name,'Apex');
  assert.equal(decoded.type,'Bible story');
  assert.equal(decoded.platform,'TikTok');
  assert.equal(decoded.email,'buyer@example.com');
  assert.equal(decoded.brief,brief);
});


test('Rapid checkout offers lower-fee ACH while retaining card payments at the advertised $25 price',()=>{
  const params=buildRapidCheckoutParams({
    orderId:'order-ach-test',name:'Apex',type:'Product ad',brief:'Test order',
    platform:'Other',email:'buyer@example.com',
    successUrl:'https://example.com/paid',cancelUrl:'https://example.com/canceled'
  });
  assert.equal(params.get('payment_method_types[0]'),'card');
  assert.equal(params.get('payment_method_types[1]'),'us_bank_account');
  assert.equal(params.get('payment_method_options[us_bank_account][verification_method]'),'automatic');
  assert.equal(params.get('line_items[0][price_data][unit_amount]'),'2500');
  assert.equal(params.get('mode'),'payment');
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
