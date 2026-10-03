import express from "express";
import { bibleCatalog } from "../biblical/bible-catalog.mjs";
import { evaluateArtifact } from "../core/evaluation.mjs";
import { exportStudio, importStudio } from "../core/import-export.mjs";
import { createAudioTrack } from "../core/audio.mjs";
import { RenderWorker } from "../core/render-worker.mjs";
import { verifyApexCommander } from "../../routes-security.mjs";
import { listStudioTools, runStudioTool } from "../core/studio-tools.mjs";
import { listVoiceOptions, synthesizeSpeech, audioEdit, generateSfx, buildAudioStation } from "../core/audio-station.mjs";
import { channelIntelligence, buildScriptBrief, generateScriptWithGemini } from "../core/youtube-intelligence.mjs";
import { analyzeChannelLifetime, createScriptPrompt, findWinningPatterns } from "../core/channel-intelligence.mjs";


export function createApi(studio){
  const r=express.Router();
  const renderWorker=new RenderWorker();
  r.get("/health",(req,res)=>res.json({ok:true,name:"Apex Production OS",version:studio.version,time:new Date().toISOString(),mode:studio.localMode.isOffline()?"offline":"network-enabled"}));
  r.get("/youtube/intelligence",async(req,res)=>{try{res.json((await channelIntelligence.load()).lifetime?channelIntelligence.summary():await channelIntelligence.load());}catch(e){res.status(500).json({error:e.message});}});
  r.get("/youtube/intelligence/videos",async(req,res)=>{try{await channelIntelligence.load();res.json(channelIntelligence.state.videoAnalysis||[]);}catch(e){res.status(500).json({error:e.message});}});
  r.post("/youtube/intelligence/ingest",async(req,res)=>{try{res.status(201).json(await channelIntelligence.ingest(req.body??{}));}catch(e){res.status(400).json({error:e.message});}});
  r.post("/youtube/intelligence/recompute",async(req,res)=>{try{await channelIntelligence.load();await channelIntelligence.recompute();await channelIntelligence.save();res.json(channelIntelligence.summary());}catch(e){res.status(500).json({error:e.message});}});
  r.get("/youtube/intelligence/export",async(req,res)=>{try{await channelIntelligence.load();res.json(channelIntelligence.state);}catch(e){res.status(500).json({error:e.message});}});
  r.post("/youtube/script/brief",(req,res)=>{try{res.status(201).json(buildScriptBrief(req.body??{}));}catch(e){res.status(400).json({error:e.message});}});
  r.post("/youtube/script/generate",async(req,res)=>{try{await channelIntelligence.load();const input={...(req.body??{}),channelIntelligence:channelIntelligence.summary()};res.status(201).json(await generateScriptWithGemini(input));}catch(e){res.status(400).json({error:e.message});}});
  r.get("/youtube/opportunities",async(req,res)=>{try{await channelIntelligence.load();res.json(channelIntelligence.state.opportunities||[]);}catch(e){res.status(500).json({error:e.message});}});

  r.get("/tools",(req,res)=>res.json(listStudioTools()));
  r.post("/tools/:tool",(req,res)=>{try{res.json({success:true,tool:req.params.tool,result:runStudioTool(req.params.tool,req.body??{})});}catch(e){res.status(400).json({success:false,error:e.message});}});
  r.get("/snapshot",(req,res)=>res.json(studio.snapshot()));
  r.get("/command-center",async(req,res)=>{try{res.json(await studio.command("command.center",{}));}catch(e){res.status(400).json({error:e.message});}});
  r.get("/privacy",(req,res)=>res.json(studio.privacy));
  r.get("/search",(req,res)=>res.json(studio.search(req.query.q??"",Number(req.query.limit??30))));
  r.get("/metrics",(req,res)=>res.json(studio.metrics.snapshot()));
  r.post("/scripts/generate",(req,res)=>{try{res.status(201).json({success:true,...createScriptPrompt(req.body??{})});}catch(e){res.status(400).json({success:false,error:e.message});}});
  r.post("/channel/analyze",(req,res)=>{try{const analysis=analyzeChannelLifetime(req.body??{});res.json({success:true,...analysis});}catch(e){res.status(400).json({success:false,error:e.message});}});
  r.post("/channel/patterns",(req,res)=>{try{res.json({success:true,patterns:findWinningPatterns(req.body?.videos??[])});}catch(e){res.status(400).json({success:false,error:e.message});}});


  r.get("/projects",(req,res)=>res.json(studio.projects.list()));
  r.post("/projects",(req,res)=>res.status(201).json(studio.projects.create(req.body??{})));
  r.post("/omni/search",async(req,res)=>{
    try{
      const body=req.body??{},sources=Array.isArray(body.sources)?body.sources:[];
      if(sources.length){
        const h=body.handshakeId?studio.omniHandshakes.get(body.handshakeId):null;
        if(!h||h.state!=="approved") return res.status(409).json({error:"Approved risk handshake required."});
      }
      const run=await studio.sex.search(body.query??"",{sources,approved:sources.length===0||Boolean(body.handshakeId)});
      if(body.inject===true){
        const research=studio.research.create({question:body.query??"",queries:run.fragments,sources:run.results.filter(x=>!x.error).map(x=>({url:x.url,status:x.status,contentType:x.contentType}))});
        for(const result of run.results.filter(x=>!x.error&&x.text)) studio.research.addClaim(research.id,{text:result.text.slice(0,4000),source:result.url,verified:false});
        await studio.save();
        run.injection={researchId:research.id,policy:"stored as unverified research; no executable content imported"};
      }
      res.status(201).json(run);
    }catch(e){res.status(400).json({error:e.message});}
  });
  r.get("/omni/events",(req,res)=>{
    res.status(200);res.set({"Content-Type":"text/event-stream","Cache-Control":"no-cache","Connection":"keep-alive"});res.flushHeaders?.();
    const send=(type,payload)=>res.write("event: "+type+"\ndata: "+JSON.stringify(payload)+"\n\n");
    const offs=["sex.started","sex.complete"].map(type=>studio.events.on(type,p=>send(type,p)));
    const heartbeat=setInterval(()=>res.write(": ping\\n\\n"),15000);
    req.on("close",()=>{clearInterval(heartbeat);offs.forEach(off=>off());});
  });
  r.post("/omni/prosody",(req,res)=>res.json(studio.command("omni.prosody",{text:req.body?.text??""})));
  r.post("/omni/stereo",(req,res)=>res.json(studio.command("omni.stereo",req.body??{})));

  r.get("/omni/production-timelines",async(req,res)=>{try{res.json(await studio.omniStore.listProductionTimelines(Number(req.query.limit??500)));}catch(e){res.status(500).json({error:e.message});}});
  r.post("/omni/production-timelines",async(req,res)=>{try{res.status(201).json(await studio.omniStore.createProductionTimeline(req.body??{}));}catch(e){res.status(400).json({error:e.message});}});
  r.get("/omni/production-timelines/:nodeId",async(req,res)=>{try{const row=await studio.omniStore.getProductionTimeline(req.params.nodeId);if(!row)return res.status(404).json({error:"Timeline node not found"});res.json(row);}catch(e){res.status(500).json({error:e.message});}});
  r.get("/omni/timeline-mutations",async(req,res)=>{try{res.json(await studio.omniStore.listTimelineMutations(req.query.parentNodeId??null,Number(req.query.limit??500)));}catch(e){res.status(500).json({error:e.message});}});
  r.post("/omni/timeline-mutations",async(req,res)=>{try{res.status(201).json(await studio.omniStore.createTimelineMutation(req.body??{}));}catch(e){res.status(400).json({error:e.message});}});
  r.get("/timelines",(req,res)=>res.json(studio.timelines.list()));
  r.post("/timelines",(req,res)=>res.status(201).json(studio.timelines.create(req.body?.name,req.body?.parentId??null)));
  r.post("/timelines/:id/events",(req,res)=>res.status(201).json(studio.timelines.addEvent(req.params.id,req.body??{})));
  r.post("/timelines/:id/branch",(req,res)=>res.status(201).json(studio.timelines.branch(req.params.id,req.body?.name??"Branch")));

  r.get("/renders",(req,res)=>res.json(studio.render.list()));
  r.post("/renders",(req,res)=>res.status(202).json(studio.render.enqueue(req.body??{})));
  r.patch("/renders/:id",(req,res)=>{const job=studio.render.mark(req.params.id,req.body?.status,req.body?.patch??{});void studio.autosave();res.json(job);});
  r.get("/renders/:id",(req,res)=>{const j=studio.render.get(req.params.id);if(!j)return res.status(404).json({error:"Render job not found"});res.json(j);});
  r.get("/renders/:id/availability",async(req,res)=>res.json({available:await renderWorker.available(),ffmpegPath:renderWorker.ffmpegPath}));
  r.get("/releases",(req,res)=>res.json(studio.releases.list()));
  r.post("/releases",(req,res)=>res.status(201).json(studio.releases.create(req.body??{})));
  r.post("/releases/:id/publish",verifyApexCommander,(req,res)=>res.json(studio.releases.publish(req.params.id)));

  r.get("/assets",(req,res)=>res.json([...studio.assets.assets.values()]));
  r.get("/media",(req,res)=>res.json(studio.media.list()));
  r.post("/media",(req,res)=>{const m=studio.media.add(req.body??{});void studio.autosave();res.status(201).json(m);});
  r.get("/audio/voices",async(req,res)=>{try{res.json({unlimitedLocal:true,voices:await listVoiceOptions()});}catch(e){res.status(500).json({error:e.message});}});
  r.post("/audio/tts",async(req,res)=>{try{const result=await synthesizeSpeech(req.body??{});res.status(201).json(result);}catch(e){res.status(400).json({error:e.message});}});
  r.post("/audio/edit",async(req,res)=>{try{res.status(201).json(await audioEdit(req.body??{}));}catch(e){res.status(400).json({error:e.message});}});
  r.post("/audio/sfx",async(req,res)=>{try{res.status(201).json(await generateSfx(req.body??{}));}catch(e){res.status(400).json({error:e.message});}});
  r.post("/audio/station/render",async(req,res)=>{try{res.status(201).json(await buildAudioStation(req.body??{}));}catch(e){res.status(400).json({error:e.message});}});
  r.get("/audio",(req,res)=>res.json([...studio.audio.values()]));
  r.post("/audio",(req,res)=>{const a=createAudioTrack(req.body??{});studio.audio.set(a.id,a);void studio.autosave();res.status(201).json(a);});
  r.post("/assets",(req,res)=>{const a=studio.assets.create(req.body??{});studio.events.emit("asset.created",a);res.status(201).json(a);});
  r.get("/jobs",(req,res)=>res.json(studio.jobs.list()));
  r.post("/jobs",(req,res)=>res.status(202).json(studio.jobs.enqueue(req.body?.type,req.body?.payload,req.body)));
  r.post("/jobs/:id/run",async(req,res)=>res.json(await studio.jobs.run(req.params.id)));

,(req,res)=>res.json(studio.research.list()));
  r.post("/research",(req,res)=>res.status(201).json(studio.research.create(req.body??{})));
  r.post("/evaluate",(req,res)=>res.json(evaluateArtifact(req.body?.artifact??{},req.body?.options??{})));
  r.get("/export",verifyApexCommander,(req,res)=>res.json(exportStudio(studio)));
  r.post("/import",verifyApexCommander,(req,res)=>res.json(importStudio(studio,req.body??{})));
  return r;
}
