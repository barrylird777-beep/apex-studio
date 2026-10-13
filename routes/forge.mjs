import express from "express";
import { asyncRoute } from "../src/api/middleware.mjs";
import { remoteProviderGuard } from "../src/api/remote-policy.mjs";
import { createGuardedFetch, sanitizeOutboundPayload } from "../src/security/sovereign-outbound-gateway.mjs";
const outboundFetch = createGuardedFetch(["image.pollinations.ai"]);
export default function forgeRoute(studio){
  const router=express.Router();
  router.use(remoteProviderGuard(studio));
  router.post("/",asyncRoute(async(req,res)=>{
    const {scene,shotType="wide",lighting="natural",mood="reverent"}=req.body??{};
    if(typeof scene!=="string" || !scene.trim()) return res.status(400).json({error:"scene is required"});
    if(scene.length>12000) return res.status(413).json({error:"scene is too large"});
    const cleanScene=scene.replace(/\b(EXT\.|INT\.|NIGHT|DAY|MORNING|EVENING|CAMERA|SLAMS|FADES)\b/g,"").replace(/\[.*?\]/g,"").replace(/\*+/g,"").replace(/\s+/g," ").trim();
    const optimizedPrompt=String(shotType).slice(0,80)+", "+cleanScene+", environment lighting: "+String(lighting).slice(0,120)+", cinematic mood: "+String(mood).slice(0,120)+", highly detailed, cinematic, photorealistic";
    const cleanPrompt=sanitizeOutboundPayload({prompt:optimizedPrompt}).prompt;
    const target="https://image.pollinations.ai/prompt/"+encodeURIComponent(cleanPrompt)+"?width=1920&height=1080&model=flux&nologo=true";
    const response=await outboundFetch(target);
    if(!response.ok) throw new Error("Visual API failed with status: "+response.status);
    res.set("Content-Type","image/jpeg").send(Buffer.from(await response.arrayBuffer()));
  }));
  return router;
}
