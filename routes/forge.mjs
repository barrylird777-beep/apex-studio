import express from "express";
import { asyncRoute } from "../src/api/middleware.mjs";
import { remoteProviderGuard } from "../src/api/remote-policy.mjs";
export default function forgeRoute(studio){
  const router=express.Router();
  router.use(remoteProviderGuard(studio));
  router.post("/",asyncRoute(async(req,res)=>{
    const {scene,shotType="wide",lighting="natural",mood="reverent"}=req.body??{};
    if(!scene) return res.status(400).json({error:"scene is required"});
    let cleanScene=String(scene).replace(/\b(EXT\.|INT\.|NIGHT|DAY|MORNING|EVENING|CAMERA|SLAMS|FADES)\b/g,"").replace(/\[.*?\]/g,"").replace(/\*+/g,"").replace(/\s+/g," ").trim();
    const optimizedPrompt=shotType+", "+cleanScene+", environment lighting: "+lighting+", cinematic mood: "+mood+", highly detailed, 8k resolution, cinematic, photorealistic";
    const response=await fetch("https://image.pollinations.ai/prompt/"+encodeURIComponent(optimizedPrompt)+"?width=1920&height=1080&model=flux&nologo=true");
    if(!response.ok) throw new Error("Visual API failed with status: "+response.status);
    res.set("Content-Type","image/jpeg").send(Buffer.from(await response.arrayBuffer()));
  }));
  return router;
}
