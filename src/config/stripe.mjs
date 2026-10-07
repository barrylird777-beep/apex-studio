export function stripeConfig(){
  const secretKey=String(process.env.STRIPE_SECRET_KEY||'').trim();
  const webhookSecret=String(process.env.STRIPE_WEBHOOK_SECRET||'').trim();
  return {secretKey,webhookSecret,configured:Boolean(secretKey&&webhookSecret),checkoutConfigured:Boolean(secretKey),webhookConfigured:Boolean(webhookSecret)};
}

export function requireStripeSecret(){ const {secretKey}=stripeConfig(); if(!secretKey) throw new Error('STRIPE_SECRET_KEY is not configured'); return secretKey; }
export function requireStripeWebhookSecret(){ const {webhookSecret}=stripeConfig(); if(!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is not configured'); return webhookSecret; }