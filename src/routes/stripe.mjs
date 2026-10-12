import express from 'express';
import { verifyRapidStripeSignature, decodeRapidCheckoutMetadata } from '../payments/stripe-rapid.mjs';
import { stripeConfig, requireStripeWebhookSecret } from '../config/stripe.mjs';

export function createStripeRouter({ durableWorkerEnabled, getWorkerTask, enqueueWorkerTask }) {
  const router=express.Router();
  router.get('/config', (_req,res)=>{ const cfg=stripeConfig(); res.json({checkoutConfigured:cfg.checkoutConfigured,webhookConfigured:cfg.webhookConfigured}); });
  router.post('/rapid/webhook', express.raw({type:'application/json',limit:'256kb'}), async (req,res)=>{
    try {
      const event=verifyRapidStripeSignature(req.body,req.headers['stripe-signature'],requireStripeWebhookSecret());
      if(!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)) return res.json({received:true,ignored:true});
      const session=event.data?.object||{}; const metadata=decodeRapidCheckoutMetadata(session.metadata||{});
      const amount=Number(session.amount_total); const paid=session.payment_status==='paid';
      if(!metadata.orderId||String(session.client_reference_id||'')!==metadata.orderId||!paid||amount!==2500||String(session.currency||'').toLowerCase()!=='usd') return res.status(400).json({received:false,error:'Invalid Rapid Video payment'});
      if(!durableWorkerEnabled()) return res.status(503).json({received:false,error:'Order queue unavailable'});
      const existing=await getWorkerTask(metadata.orderId); if(existing) return res.json({received:true,duplicate:true,orderId:metadata.orderId});
      await enqueueWorkerTask({id:metadata.orderId,workerId:'rapid-video-intake',role:'rapid-video',task:'rapid-video-order',payload:{orderId:metadata.orderId,name:metadata.name,type:metadata.type,brief:metadata.brief,platform:metadata.platform,email:metadata.email||String(session.customer_details?.email||session.customer_email||''),price:25,paid:true,stripeSessionId:String(session.id||''),paidAt:new Date().toISOString()},maxAttempts:3,dedupeKey:'rapid-paid:'+metadata.orderId,traceId:metadata.orderId});
      return res.json({received:true,queued:true,orderId:metadata.orderId});
    } catch(error) { console.error('[rapid-stripe-webhook]',error); return res.status(400).json({received:false,error:error.message||'Webhook verification failed'}); }
  });
  return router;
}