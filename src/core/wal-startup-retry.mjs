const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function retryWalStartup(initialize,{
  isStopping=()=>false,
  wait=sleep,
  onRetry=({attempt,delayMs})=>console.error("[SOVEREIGN] WAL lock busy; retrying storage startup",JSON.stringify({attempt,delayMs})),
  baseDelayMs=250,
  maxDelayMs=30000,
  random=Math.random
}={}){
  let attempt=0;
  while(!isStopping()){
    try{return await initialize();}
    catch(error){
      const message=String(error?.message||error);
      if(!message.includes("[WAL_LOCK]"))throw error;
      attempt++;
      const ceiling=Math.min(maxDelayMs,baseDelayMs*2**Math.min(attempt-1,10));
      const jitter=Math.floor(random()*Math.max(1,baseDelayMs/2));
      const delayMs=Math.min(maxDelayMs,ceiling+jitter);
      onRetry({attempt,delayMs,error});
      await wait(delayMs);
    }
  }
  return false;
}
