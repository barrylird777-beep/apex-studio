import express from "express";
import { asyncRoute } from "../src/api/middleware.mjs";
import { remoteProviderGuard } from "../src/api/remote-policy.mjs";
export default function oracleRoute(studio){
  const router=express.Router();
  router.use(remoteProviderGuard(studio));
  router.post("/",asyncRoute(async(req,res)=>{
    const {era,duration,pacing,score,details}=req.body??{};
    if(!details) return res.status(400).json({error:"details is required"});
    const prompt="Write a cinematic production script for a biblical scene. Epoch: "+(era??"unspecified")+". Duration: "+(duration??"unspecified")+". Pacing/Tone: "+(pacing??"unspecified")+". Score: "+(score??"unspecified")+". Details: "+details+". Include [VISUAL] blocks and [NARRATOR / AUDIO] blocks.";
    const response=await fetch("https://text.pollinations.ai/",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:[{role:"system",content:"You are an expert cinematic screenwriter."},{role:"user",content:prompt}],model:"openai"})});
    if(!response.ok) throw new Error("Oracle AI failed with status: "+response.status);
    res.json({result:await response.text()});
  }));
  return router;
}
