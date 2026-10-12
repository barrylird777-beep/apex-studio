import express from "express";
import { asyncRoute } from "../src/api/middleware.mjs";
import { remoteProviderGuard } from "../src/api/remote-policy.mjs";
export default function bardRoute(studio){
  const router=express.Router();
  router.use(remoteProviderGuard(studio));
  router.post("/",asyncRoute(async(req,res)=>{
    const {text}=req.body??{};
    if(!text) return res.status(400).json({error:"text is required"});
    const response=await fetch("https://api-inference.huggingface.co/models/espnet/kan-bayashi_ljspeech_vits",{headers:{"Content-Type":"application/json"},method:"POST",body:JSON.stringify({inputs:text})});
    if(!response.ok) throw new Error("Audio API failed with status: "+response.status);
    res.set("Content-Type","audio/flac").send(Buffer.from(await response.arrayBuffer()));
  }));
  return router;
}
