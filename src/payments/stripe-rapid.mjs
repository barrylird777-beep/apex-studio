import crypto from 'node:crypto';
import https from 'node:https';
import dns from 'node:dns';

const STRIPE_API='https://api.stripe.com/v1';

function requireSecret(){
  const key=String(process.env.STRIPE_SECRET_KEY||'').trim();
  if(!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  return key;
}

function encode(value){
  return Buffer.from(String(value??''),'utf8').toString('base64url');
}
function decode(value){
  return Buffer.from(String(value||''),'base64url').toString('utf8');
}

function splitBriefForStripe(value, maxBytes = 360){
  const text=String(value||'');
  const parts=[];
  let current='';
  for(const char of text){
    const next=current+char;
    if(current && Buffer.byteLength(next,'utf8')>maxBytes){
      parts.push(current);
      current=char;
    } else {
      current=next;
    }
  }
  if(current || !parts.length) parts.push(current);
  return parts;
}

export function buildRapidCheckoutMetadata({orderId,name,type,brief,platform,email}){
  const out={
    orderId:String(orderId),
    name:String(name||'').slice(0,500),
    type:String(type||'').slice(0,500),
    platform:String(platform||'Other').slice(0,500),
    email:String(email||'').trim().slice(0,320),
    briefParts:splitBriefForStripe(brief)
  };
  const metadata={orderId:out.orderId,name:out.name,type:out.type,platform:out.platform,email:out.email};
  out.briefParts.forEach((part,i)=>{metadata['brief_'+String(i+1).padStart(2,'0')]=encode(part).slice(0,500);});
  return metadata;
}

export function decodeRapidCheckoutMetadata(metadata={}){
  const keys=Object.keys(metadata).filter(k=>/^brief_\d+$/.test(k)).sort();
  return {
    orderId:String(metadata.orderId||''),
    name:String(metadata.name||''),
    type:String(metadata.type||''),
    platform:String(metadata.platform||'Other'),
    email:String(metadata.email||''),
    brief:keys.map(k=>decode(metadata[k])).join('')
  };
}

export async function createRapidCheckout({orderId,name,type,brief,platform,email,successUrl,cancelUrl}){
  const secret=requireSecret();
  const params=new URLSearchParams();
  const add=(k,v)=>params.set(k,String(v));
  add('mode','payment');
  add('success_url',successUrl);
  add('cancel_url',cancelUrl);
  add('client_reference_id',orderId);
  if (String(email||'').trim()) add('customer_email',String(email).trim());
  add('line_items[0][price_data][currency]','usd');
  add('line_items[0][price_data][unit_amount]','2500');
  add('line_items[0][price_data][product_data][name]','Apex Rapid Video');
  add('line_items[0][price_data][product_data][description]','One finished short-form video production.');
  add('line_items[0][quantity]','1');
  for(const [k,v] of Object.entries(buildRapidCheckoutMetadata({orderId,name,type,brief,platform,email}))) add('metadata['+k+']',v);

  const body=await new Promise((resolve,reject)=>{
    const request=https.request(STRIPE_API+'/checkout/sessions',{
      method:'POST',
      family:4,
      lookup:(hostname, options, callback)=>dns.lookup(hostname,{family:4,all:false},callback),
      headers:{Authorization:'Bearer '+secret,'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(params.toString())},
      timeout:15000
    },response=>{
      let text='';
      response.setEncoding('utf8');
      response.on('data',chunk=>{text+=chunk;});
      response.on('end',()=>{
        let parsed={};
        try{parsed=text?JSON.parse(text):{};}catch{}
        resolve({status:response.statusCode||0,ok:(response.statusCode||0)>=200&&(response.statusCode||0)<300,...parsed});
      });
    });
    request.on('timeout',()=>request.destroy(new Error('Stripe checkout request timed out')));
    request.on('error',reject);
    request.end(params.toString());
  });
  if(!response.ok) throw new Error('Stripe checkout '+response.status+': '+String(body?.error?.message||'request failed'));
  if(!body?.id||!body?.url) throw new Error('Stripe returned an incomplete checkout session');
  return {id:String(body.id),url:String(body.url)};
}

export function verifyRapidStripeSignature(rawBody,header,secret){
  if(!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  const signature=String(header||'');
  const timestampMatch=signature.match(/(?:^|,)t=(\d+)/);
  const signatures=[...signature.matchAll(/(?:^|,)v1=([a-f0-9]+)/g)].map(m=>m[1]);
  if(!timestampMatch||!signatures.length) throw new Error('Invalid Stripe-Signature header');
  const timestamp=Number(timestampMatch[1]);
  if(!Number.isFinite(timestamp)) throw new Error('Invalid Stripe signature timestamp');
  if(Math.abs(Date.now()/1000-timestamp)>300) throw new Error('Expired Stripe signature');
  const payload=Buffer.isBuffer(rawBody)?rawBody.toString('utf8'):String(rawBody||'');
  const expected=crypto.createHmac('sha256',secret).update(timestamp+'.'+payload).digest('hex');
  const ok=signatures.some(value=>{
    const a=Buffer.from(value,'hex'),b=Buffer.from(expected,'hex');
    return a.length===b.length&&crypto.timingSafeEqual(a,b);
  });
  if(!ok) throw new Error('Invalid Stripe signature');
  try{return JSON.parse(payload);}catch{throw new Error('Invalid Stripe webhook JSON');}
}
