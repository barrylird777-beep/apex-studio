import crypto from 'node:crypto';

const API = 'https://api.stripe.com/v1';
const cents = (value, fallback) => Number.isFinite(Number(value)) ? Math.max(1, Math.round(Number(value))) : fallback;

function key(){if(!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe is not configured'); return process.env.STRIPE_SECRET_KEY;}
async function stripeRequest(path, body){
  const params=new URLSearchParams();
  for(const [k,v] of Object.entries(body||{})) if(v!==undefined&&v!==null) params.set(k,String(v));
  const response=await fetch(API+path,{method:'POST',headers:{Authorization:'Bearer '+key(),'Content-Type':'application/x-www-form-urlencoded'},body:params});
  const text=await response.text();
  let data; try{data=JSON.parse(text)}catch{data={raw:text}};
  if(!response.ok) throw new Error(data?.error?.message||('Stripe API '+response.status));
  return data;
}

export async function createRapidCheckout({orderId,priceCents=2500,sharedCredit=false,origin}={}){
  if(!orderId) throw new Error('orderId required');
  const total=cents(priceCents,2500);
  const originUrl=String(origin||process.env.PUBLIC_BASE_URL||'').replace(/\/$/,'');
  if(!originUrl) throw new Error('PUBLIC_BASE_URL is required for checkout redirects');
  return stripeRequest('/checkout/sessions',{
    'mode':'payment',
    'line_items[0][price_data][currency]':process.env.STRIPE_CURRENCY||'usd',
    'line_items[0][price_data][product_data][name]':sharedCredit?'Apex Rapid Video — Creator Credit':'Apex Rapid Video — 30–60 Second Short',
    'line_items[0][price_data][product_data][description]':sharedCredit?'Launch pricing with an @ApexStudio creator credit at the end of the video.':'One 30–60 second Apex Rapid Video.',
    'line_items[0][price_data][unit_amount]':total,
    'line_items[0][quantity]':1,
    'client_reference_id':orderId,
    'metadata[order_id]':orderId,
    'metadata[shared_credit]':sharedCredit?'true':'false',
    'success_url':originUrl+'/rapid-video.html?paid=1&order_id='+encodeURIComponent(orderId),
    'cancel_url':originUrl+'/rapid-video.html?paid=0&order_id='+encodeURIComponent(orderId)
  });
}

export function verifyStripeSignature(rawBody, signatureHeader, secret=process.env.STRIPE_WEBHOOK_SECRET){
  if(!secret) throw new Error('STRIPE_WEBHOOK_SECRET is required');
  if(!signatureHeader) throw new Error('Missing Stripe signature');
  const parts=Object.fromEntries(String(signatureHeader).split(',').map(x=>x.split('=')));
  const timestamp=Number(parts.t);
  const signatures=String(signatureHeader).split(',').filter(x=>x.startsWith('v1=')).map(x=>x.slice(3));
  if(!Number.isFinite(timestamp)||Math.abs(Date.now()/1000-timestamp)>300) throw new Error('Stripe webhook timestamp outside tolerance');
  const expected=crypto.createHmac('sha256',secret).update(String(timestamp)+'.').update(rawBody).digest('hex');
  const matched=signatures.some(value=>{try{return crypto.timingSafeEqual(Buffer.from(value,'hex'),Buffer.from(expected,'hex'));}catch{return false;}});
  if(!matched) throw new Error('Stripe webhook signature verification failed');
  return JSON.parse(rawBody);
}
