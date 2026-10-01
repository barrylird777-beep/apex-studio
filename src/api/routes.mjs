import express from "express";
export function createApi(studio){
 const r=express.Router();
 r.get("/health",(req,res)=>res.json({ok:true,studio:"Apex Studio",version:studio.version,time:new Date().toISOString()}));
 r.get("/snapshot",(req,res)=>res.json({version:studio.version,projects:studio.projects.list(),agents:studio.agents.list(),assets:[...studio.assets.assets.values()],world:studio.world.snapshot(),production:{nodes:[...studio.production.nodes.values()],edges:studio.production.edges},graph:studio.graph.snapshot(),memories:studio.memory.items.length}));
 r.post("/projects",(req,res)=>res.status(201).json(studio.projects.create(req.body??{})));
 r.get("/projects",(req,res)=>res.json(studio.projects.list()));
 r.post("/memory",(req,res)=>res.status(201).json(studio.memory.remember(req.body??{})));
 r.get("/memory",(req,res)=>res.json(studio.memory.search(req.query.q??"",{projectId:req.query.projectId}))); 
 r.post("/assets",(req,res)=>{const a=studio.assets.create(req.body??{});studio.events.emit("asset.created",a);res.status(201).json(a)});
 r.post("/characters",(req,res)=>res.status(201).json(studio.characters.create(req.body??{})));
 return r;
}
