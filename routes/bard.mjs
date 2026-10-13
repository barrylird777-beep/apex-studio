import express from "express";
import { asyncRoute } from "../src/api/middleware.mjs";
import { remoteProviderGuard } from "../src/api/remote-policy.mjs";
import { createGuardedFetch, sanitizeOutboundPayload } from "../src/security/sovereign-outbound-gateway.mjs";
const outboundFetch = createGuardedFetch(["api-inference.huggingface.co"]);
export default function bardRoute(studio){
  const router=express.Router();
  router.use(remoteProviderGuard(studio));
  router.post("/",asyncRoute(async(req,res)=>{
    const {text}=req.body??{};
    if(typeof text!=="string" || !text.trim()) return res.status(400).json({error:"text is required"});
    if(text.length>12000) return res.status(413).json({error:"text is too large"});
    const cleanText=sanitizeOutboundPayload({input:text}).input;
    const response=await outboundFetch("https://api-inference.huggingface.co/models/espnet/kan-bayashi_ljspeech_vits",{headers:{"Content-Type":"application/json"},method:"POST",body:JSON.stringify({inputs:cleanText})});
    if(!response.ok) throw new Error("Audio API failed with status: "+response.status);
    res.set("Content-Type","audio/flac").send(Buffer.from(await response.arrayBuffer()));
  }));
  return router;
}
