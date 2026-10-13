import express from "express";
import { asyncRoute } from "../src/api/middleware.mjs";
import { remoteProviderGuard } from "../src/api/remote-policy.mjs";
import { createGuardedFetch, sanitizeOutboundPayload } from "../src/security/sovereign-outbound-gateway.mjs";
const outboundFetch = createGuardedFetch(["text.pollinations.ai"]);
export default function oracleRoute(studio){
  const router=express.Router();
  router.use(remoteProviderGuard(studio));
  router.post("/",asyncRoute(async(req,res)=>{
    const {era,duration,pacing,score,details}=req.body??{};
    if(typeof details!=="string" || !details.trim()) return res.status(400).json({error:"details is required"});
    if(details.length>12000) return res.status(413).json({error:"details is too large"});
    const prompt="Write a cinematic production script for a biblical scene. Epoch: "+String(era??"unspecified").slice(0,200)+". Duration: "+String(duration??"unspecified").slice(0,200)+". Pacing/Tone: "+String(pacing??"unspecified").slice(0,200)+". Score: "+String(score??"unspecified").slice(0,200)+". Details: "+details+". Include [VISUAL] blocks and [NARRATOR / AUDIO] blocks.";
    const cleanPrompt=sanitizeOutboundPayload({prompt}).prompt;
    const response=await outboundFetch("https://text.pollinations.ai/",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:[{role:"system",content:"You are an expert cinematic screenwriter."},{role:"user",content:cleanPrompt}],model:"openai"})});
    if(!response.ok) throw new Error("Oracle AI failed with status: "+response.status);
    res.json({result:await response.text()});
  }));
  return router;
}
