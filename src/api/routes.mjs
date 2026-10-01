import express from "express";
import { exportStudio, importStudio } from "../core/import-export.mjs";
import { evaluateArtifact } from "../core/evaluation.mjs";
export function createApi(studio){
 const r=express.Router();
 r.get("/health",(req,res)=>res.json({ok:true,name:"Apex Studio",version:studio.version,time:new Date().toISOString()}));
 r.get("/snapshot",(req,res)=>res.json(studio.snapshot()));
 r.get("/search",(req,res)=>res.json(studio.search(req.query.q??"",Number(req.query.limit??30))));
 r.get("/metrics",(req,res)=>res.json(studio.metrics.snapshot()));
 r.get("/universe",(req,res)=>res.json(studio.universe.list()));
 r.get("/projects",(req,res)=>res.json(studio.projects.list()));
 r.post("/projects",(req,res)=>res.status(201).json(studio.projects.create(req.body??{})));
 r.get("/memory",(req,res)=>res.json(studio.memory.search(req.query.q??"",{projectId:req.query.projectId})));
 r.post("/memory",(req,res)=>res.status(201).json(studio.memory.remember(req.body??{})));
 r.get("/characters",(req,res)=>res.json(studio.characters?.list?.()??[]));
 r.post("/characters",(req,res)=>res.status(201).json(studio.characters.create(req.body??{})));
 r.post("/assets",(req,res)=>{const a=studio.assets.create(req.body??{});studio.events.emit("asset.created",a);res.status(201).json(a)});
 r.get("/scenes",(req,res)=>res.json(studio.listScenes()));
 r.post("/scenes",(req,res)=>res.status(201).json(studio.createScene(req.body??{})));
 r.get("/jobs",(req,res)=>res.json(studio.jobs.list()));
 r.post("/jobs",(req,res)=>res.status(202).json(studio.jobs.enqueue(req.body?.type,req.body?.payload,req.body)));
 r.post("/jobs/:id/run",async(req,res)=>res.json(await studio.jobs.run(req.params.id)));
 r.get("/tools",(req,res)=>res.json(studio.tools.describe()));
 r.get("/providers",(req,res)=>res.json(studio.providers.names()));
 r.post("/evaluate",(req,res)=>res.json(evaluateArtifact(req.body?.artifact,{requiredFields:req.body?.requiredFields??[],provenance:req.body?.provenance??[],continuity:req.body?.continuity??[]})));
 r.get("/export",(req,res)=>res.json(exportStudio(studio)));
 r.post("/import",(req,res)=>{try{res.json(importStudio(studio,req.body))}catch(e){res.status(400).json({error:e.message})}});
 return r;
}
