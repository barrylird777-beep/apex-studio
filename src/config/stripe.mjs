export function stripeConfig(){
  const secretKey=String(process.env.STRIPE_SECRET_KEY||'').trim();
  const webhookSecret=String(process.env.STRIPE_WEBHOOK_SECRET||'').trim();
  const requestedMode=String(process.env.STRIPE_MODE||'test').trim().toLowerCase();
  const mode=requestedMode==='test'?'test':'live';
  const keyMatchesMode=!secretKey || (mode==='test' ? secretKey.startsWith('sk_test_') : secretKey.startsWith('sk_live_'));
  return {secretKey,webhookSecret,mode,configured:Boolean(secretKey&&webhookSecret&&keyMatchesMode),checkoutConfigured:Boolean(secretKey&&keyMatchesMode),webhookConfigured:Boolean(webhookSecret),keyMatchesMode};
}

export function requireStripeSecret(){
  const {secretKey,mode,keyMatchesMode}=stripeConfig();
  if(!secretKey) throw new Error('STRIPE_SECRET_KEY is not configured');
  if(!keyMatchesMode) throw new Error('STRIPE_SECRET_KEY does not match STRIPE_MODE='+mode);
  return secretKey;
}
export function requireStripeWebhookSecret(){ const {webhookSecret}=stripeConfig(); if(!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is not configured'); return webhookSecret; }