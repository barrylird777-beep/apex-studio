import express from "express";
import { bibleCatalog } from "../biblical/bible-catalog.mjs";
import { evaluateArtifact } from "../core/evaluation.mjs";
import { exportStudio, importStudio } from "../core/import-export.mjs";
import { createShot } from "../core/scene.mjs";
import { buildStoryboard } from "../core/storyboard.mjs";
import { createAudioTrack } from "../core/audio.mjs";
import { RenderWorker } from "../core/render-worker.mjs";
import { buildVisualPrompt } from "../core/visual-generation.mjs";
import { verifyApexCommander } from "../../routes-security.mjs";

function episodeReadinessRoute(studio,id){ const episode=studio.episodes.get(id); if(!episode) throw new Error("Episode not found"); return studio.command("episode.readiness",{id}); }

export function createApi(studio){
  const r=express.Router();
  const renderWorker=new RenderWorker();
  r.get("/health",(req,res)=>res.json({ok:true,name:"Apex Bible Story Studio",version:studio.version,time:new Date().toISOString(),mode:studio.localMode.isOffline()?"offline":"network-enabled"}));
  r.get("/snapshot",(req,res)=>res.json(studio.snapshot()));
  r.get("/command-center",async(req,res)=>{try{res.json(await studio.command("command.center",{}));}catch(e){res.status(400).json({error:e.message});}});
  r.get("/privacy",(req,res)=>res.json(studio.privacy));
  r.get("/search",(req,res)=>res.json(studio.search(req.query.q??"",Number(req.query.limit??30))));
  r.get("/metrics",(req,res)=>res.json(studio.metrics.snapshot()));
  r.get("/biblical/catalog",(req,res)=>res.json(bibleCatalog()));
  r.get("/sacred/catalog",async(req,res)=>{try{res.json(await studio.command("sacred.catalog",{}));}catch(e){res.status(400).json({error:e.message});}});
  r.post("/quirks/suggest",(req,res)=>Promise.resolve(studio.command("quirk.suggest",req.body??{})).then(v=>res.json(v)).catch(e=>res.status(400).json({error:e.message})));
  r.post("/quirks/audit",(req,res)=>Promise.resolve(studio.command("quirk.audit",req.body?.quirks??[])).then(v=>res.json(v)).catch(e=>res.status(400).json({error:e.message})));

  r.get("/projects",(req,res)=>res.json(studio.projects.list()));
  r.post("/projects",(req,res)=>res.status(201).json(studio.projects.create(req.body??{})));

  r.get("/stories",(req,res)=>res.json(studio.biblical.listStories()));
  r.post("/stories",(req,res)=>{const story=studio.biblical.createStory(req.body??{});void studio.autosave();res.status(201).json(story);});
  r.get("/stories/:id",(req,res)=>{const story=studio.biblical.getStory(req.params.id);if(!story)return res.status(404).json({error:"Story not found"});res.json({...story,events:studio.biblical.listEvents(req.params.id)});});
  r.post("/stories/:id/events",(req,res)=>{const event=studio.biblical.addEvent(req.params.id,req.body??{});void studio.autosave();res.status(201).json(event);});
  r.get("/stories/:id/events",(req,res)=>res.json(studio.biblical.listEvents(req.params.id)));
  r.post("/stories/events/:eventId/scene",(req,res)=>{const scene=studio.biblical.toScene(req.params.eventId,req.body??{});studio.scenes.set(scene.id,scene);return res.status(201).json(scene);});
  r.get("/stories/events/:eventId/provenance",(req,res)=>res.json(studio.biblical.provenance(req.params.eventId)));

  r.post("/retention/opening",(req,res)=>res.status(201).json(studio.retention.create(req.body??{})));
  r.post("/retention/prompt",(req,res)=>res.json({prompt:studio.retention.prompt(req.body??{})}));
  r.get("/episodes",(req,res)=>res.json([...studio.episodes.values()]));
  r.post("/episodes",(req,res)=>{const x=studio.command("episode.create",req.body??{});Promise.resolve(x).then(v=>res.status(201).json(v)).catch(e=>res.status(400).json({error:e.message}));});
  r.post("/episodes/plan",(req,res)=>{const x=studio.command("episode.plan",req.body??{});Promise.resolve(x).then(v=>res.status(201).json(v)).catch(e=>res.status(400).json({error:e.message}));});
  r.post("/episodes/compile",(req,res)=>{Promise.resolve(studio.command("episode.compile",req.body??{})).then(v=>res.status(201).json(v)).catch(e=>res.status(400).json({error:e.message}));});
  r.post("/episodes/:id/canon",(req,res)=>{Promise.resolve(studio.command("canon.attachEpisode",{episodeId:req.params.id,entityIds:req.body?.entityIds??[]})).then(v=>res.json(v)).catch(e=>res.status(400).json({error:e.message}));});
  r.post("/episodes/direct",(req,res)=>{Promise.resolve(studio.command("episode.direct",req.body??{})).then(v=>res.status(201).json(v)).catch(e=>res.status(400).json({error:e.message}));});
  r.get("/episodes/:id/story-intelligence",(req,res)=>{const episode=studio.episodes.get(req.params.id);if(!episode)return res.status(404).json({error:"Episode not found"});res.json(episode.storyIntelligence??null);});
  r.post("/episodes/:id/story-intelligence",(req,res)=>{const episode=studio.episodes.get(req.params.id);if(!episode)return res.status(404).json({error:"Episode not found"});episode.storyIntelligence={...(episode.storyIntelligence??{}),...(req.body??{}),episodeId:episode.id};episode.storyIntelligenceAudit=studio.command("storyIntelligence.audit",episode.storyIntelligence);void studio.autosave();Promise.resolve(episode.storyIntelligenceAudit).then(v=>res.status(201).json({storyIntelligence:episode.storyIntelligence,audit:v})).catch(e=>res.status(400).json({error:e.message}));});
  r.post("/story-intelligence/analyze",(req,res)=>res.json({prompt:studio.command("storyIntelligence.prompt",req.body??{})}));
  r.get("/episodes/:id",(req,res)=>{const episode=studio.episodes.get(req.params.id);if(!episode)return res.status(404).json({error:"Episode not found"});res.json(episode);});
  r.get("/episodes/:id/compiler",(req,res)=>{Promise.resolve(studio.command("episode.compilerReport",{id:req.params.id})).then(v=>res.json(v)).catch(e=>res.status(404).json({error:e.message}));});
  r.get("/episodes/:id/director",(req,res)=>{Promise.resolve(studio.command("episode.directReport",{id:req.params.id})).then(v=>res.json(v)).catch(e=>res.status(404).json({error:e.message}));});
  r.get("/episodes/:id/story-architecture",(req,res)=>{Promise.resolve(studio.command("storyArchitecture.audit",studio.episodes.get(req.params.id)?.storyArchitecture)).then(v=>res.json(v)).catch(e=>res.status(404).json({error:e.message}));});
  r.get("/episodes/:id/quality-gate",(req,res)=>{Promise.resolve(studio.command("episode.qualityGate",{id:req.params.id})).then(v=>res.json(v)).catch(e=>res.status(404).json({error:e.message}));});
  r.get("/episodes/:id/readiness",(req,res)=>{Promise.resolve(episodeReadinessRoute(studio,req.params.id)).then(v=>res.json(v)).catch(e=>res.status(404).json({error:e.message}));});
  r.post("/episodes/:id/entertainment-audit",(req,res)=>{Promise.resolve(studio.command("episode.entertainment",{id:req.params.id})).then(x=>res.json(x)).catch(e=>res.status(404).json({error:e.message}));});
  r.post("/episodes/:id/advance",(req,res)=>{studio.command("episode.advance",{id:req.params.id,stage:req.body?.stage}).then(x=>res.json(x)).catch(e=>res.status(400).json({error:e.message}));});
  r.get("/bible/catalog",(req,res)=>res.json(studio.bibleCatalog));
  r.get("/bible/versions",(req,res)=>res.json(studio.bibleCatalog.editions));
  r.get("/bible/search",(req,res)=>{const q=String(req.query.q??"").trim();const version=String(req.query.version??"kjv");if(!q)return res.status(400).json({error:"q is required"});return studio.bibleSearch(version,q).then(x=>res.json(x)).catch(e=>res.status(404).json({error:e.message}))});
  r.get("/bible/passage",(req,res)=>{const root=process.env.APEX_BIBLE_DIR||"./data/bibles";const version=String(req.query.version??"kjv");const passage=String(req.query.passage??"").trim();if(!passage)return res.status(400).json({error:"passage is required"});Promise.resolve(studio.command("source.resolvePassage",{root,slug:version,passage})).then(x=>res.json(x)).catch(e=>res.status(400).json({error:e.message}));});
  r.get("/canon",(req,res)=>res.json(studio.canon));
  r.get("/canon/audit",(req,res)=>res.json(studio.command("canon.audit",{})));
  r.get("/canon/episodes/:episodeId",(req,res)=>res.json(studio.command("canon.episode",{episodeId:req.params.episodeId})));
  r.post("/canon/entities",(req,res)=>res.status(201).json(studio.command("canon.entity.add",req.body??{})));
  r.patch("/canon/entities/:id",(req,res)=>{try{res.json(studio.command("canon.entity.update",{id:req.params.id,...(req.body??{})}));}catch(e){res.status(400).json({error:e.message});}});
  r.post("/canon/relationships",(req,res)=>res.status(201).json(studio.command("canon.relate",req.body??{})));
  r.post("/canon/events",(req,res)=>res.status(201).json(studio.command("canon.event",req.body??{})));
  r.get("/visual-bible/characters",(req,res)=>res.json(studio.visualBible.listCharacters()));
  r.post("/visual-bible/characters",(req,res)=>{const x=studio.visualBible.createCharacter(req.body??{});void studio.autosave();res.status(201).json(x);});
  r.get("/visual-bible/locations",(req,res)=>res.json(studio.visualBible.listLocations()));
  r.post("/visual-bible/locations",(req,res)=>{const x=studio.visualBible.createLocation(req.body??{});void studio.autosave();res.status(201).json(x);});
  r.get("/scenes/:id/visual-prompts",(req,res)=>{const scene=studio.getScene(req.params.id);if(!scene)return res.status(404).json({error:"Scene not found"});const shots=scene.shots??[];res.json(shots.map(shot=>buildVisualPrompt({shot,characters:(shot.characterIds??[]).map(id=>studio.visualBible.getCharacter(id)).filter(Boolean),location:studio.visualBible.getLocation(shot.locationId),canonEntities:(shot.canonEntityIds??[]).map(id=>studio.canon.entities.find(x=>x.id===id)).filter(Boolean)})));});
  r.post("/generation",(req,res)=>{const j=studio.generation.enqueue(req.body??{});void studio.autosave();res.status(202).json(j);});
  r.get("/generation",(req,res)=>res.json(studio.generation.list()));
  r.patch("/generation/:id",(req,res)=>{const j=studio.generation.mark(req.params.id,req.body?.status,req.body?.patch??{});void studio.autosave();res.json(j);});
  r.get("/characters",(req,res)=>res.json(studio.characters.list()));
  r.post("/characters",(req,res)=>res.status(201).json(studio.characters.create(req.body??{})));
  r.get("/sources",(req,res)=>res.json(studio.sources.list()));
  r.post("/sources",(req,res)=>res.status(201).json(studio.sources.add(req.body??{})));
  r.get("/documents",(req,res)=>res.json(studio.knowledgeBase.list()));
  r.post("/documents",(req,res)=>res.status(201).json(studio.knowledgeBase.addDocument(req.body??{})));
  r.post("/documents/:id/chunk",(req,res)=>res.json(studio.knowledgeBase.chunk(req.params.id,Number(req.body?.size??1200))));
  r.get("/documents/search",(req,res)=>res.json(studio.knowledgeBase.search(req.query.q??"",Number(req.query.limit??20))));

  r.get("/editor/state",(req,res)=>res.json({scenes:studio.listScenes(),search:studio.search("",50)}));
  r.get("/editor/search",(req,res)=>res.json(studio.search(req.query.q??"",Number(req.query.limit??30))));
  r.patch("/editor/scenes/:id",async(req,res)=>{
    const scene=studio.getScene(req.params.id);
    if(!scene)return res.status(404).json({error:"Scene not found"});
    const allowed=["title","notes","locationId","characters","beats","dialogue","continuityRefs","sourceRefs","status"];
    const patch=Object.fromEntries(Object.entries(req.body??{}).filter(([k])=>allowed.includes(k)));
    const before=structuredClone(scene);
    try{
      const result=studio.commands.execute({
        targetId:scene.id,
        type:"scene.patch",
        do(){Object.assign(scene,structuredClone(patch));scene.updatedAt=new Date().toISOString();return scene;},
        undo(){Object.assign(scene,structuredClone(before));return scene;}
      });
      await studio.save();
      res.json(result);
    }catch(e){res.status(400).json({error:e.message});}
  });
  r.post("/editor/undo",async(req,res)=>{try{const result=studio.commands.undo();await studio.save();res.json({result});}catch(e){res.status(400).json({error:e.message});}});
  r.post("/editor/redo",async(req,res)=>{try{const result=studio.commands.redo();await studio.save();res.json({result});}catch(e){res.status(400).json({error:e.message});}});
  r.get("/omni/status",async(req,res)=>res.json({mode:"STANDARD",privacy:studio.privacy,concurrency:Number(process.env.APEX_SEX_CONCURRENCY??4)}));
  r.post("/omni/risk",(req,res)=>{try{res.json(studio.beginOmniReview(req.body??{}));}catch(e){res.status(400).json({error:e.message});}});
  r.post("/omni/risk/:id/confirm",(req,res)=>{try{res.json(studio.confirmOmniReview(req.params.id,req.body?.approved===true));}catch(e){res.status(400).json({error:e.message});}});
  r.post("/omni/search",async(req,res)=>{
    try{
      const body=req.body??{}, sources=Array.isArray(body.sources)?body.sources:[];
      if(sources.length && body.handshakeId) {
        const h=studio.omniHandshakes.get(body.handshakeId);
        if(!h||h.state!=="approved") return res.status(409).json({error:"Approved risk handshake required."});
      } else if(sources.length) return res.status(409).json({error:"Risk handshake required before outbound retrieval."});
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
  r.post("/omni/narrative",async(req,res)=>{try{res.status(201).json(await studio.command("narrative.create",req.body??{}));}catch(e){res.status(400).json({error:e.message});}});
  r.post("/omni/narrative/:id/block",async(req,res)=>{try{res.json(await studio.command("narrative.block",{trackId:req.params.id,...(req.body??{})}));}catch(e){res.status(400).json({error:e.message});}});
  r.get("/omni/narrative",(req,res)=>res.json([...studio.narrativeTracks.values()]));
  r.get("/scenes",(req,res)=>res.json(studio.listScenes()));
  r.post("/scenes",(req,res)=>res.status(201).json(studio.createScene(req.body??{})));
  r.post("/scenes/:id/storyboard",(req,res)=>{const scene=studio.getScene(req.params.id);if(!scene)return res.status(404).json({error:"Scene not found"});scene.shots=buildStoryboard(scene).map((s,i)=>({...s,index:i}));scene.updatedAt=new Date().toISOString();void studio.autosave();return res.status(201).json(scene.shots);});
  r.post("/scenes/:id/shots",(req,res)=>{const scene=studio.getScene(req.params.id);if(!scene)return res.status(404).json({error:"Scene not found"});const shot=createShot({...req.body,sceneId:scene.id,index:scene.shots.length});scene.shots.push(shot);scene.updatedAt=new Date().toISOString();return res.status(201).json(shot);});

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
  r.post("/renders/:id/run",async(req,res)=>{const job=studio.render.get(req.params.id);if(!job)return res.status(404).json({error:"Render job not found"});try{const manifest=await studio.render.writeManifest(job,studio.listScenes(),req.body?.outDir,studio.media.list(),[...studio.audio.values()]);const result=await renderWorker.render(job,manifest.ffmpeg);studio.render.mark(job.id,"completed",{output:result.output,finishedAt:result.finishedAt});void studio.autosave();res.json(result)}catch(error){studio.render.mark(job.id,"failed",{error:error.message,renderResult:error.result??null});void studio.autosave();res.status(500).json({error:error.message,result:error.result??null})}});
  r.post("/renders/:id/cancel",(req,res)=>res.json({cancelled:renderWorker.cancel(req.params.id)}));
  r.post("/renders/:id/prepare",async(req,res)=>{const job=studio.render.get(req.params.id);if(!job)return res.status(404).json({error:"Render job not found"});const manifest=await studio.render.writeManifest(job,studio.listScenes(),req.body?.outDir,studio.media.list(),[...studio.audio.values()]);void studio.autosave();res.json(manifest);});

  r.get("/releases",(req,res)=>res.json(studio.releases.list()));
  r.post("/releases",(req,res)=>res.status(201).json(studio.releases.create(req.body??{})));
  r.post("/releases/:id/publish",verifyApexCommander,(req,res)=>res.json(studio.releases.publish(req.params.id)));

  r.get("/assets",(req,res)=>res.json([...studio.assets.assets.values()]));
  r.get("/media",(req,res)=>res.json(studio.media.list()));
  r.post("/media",(req,res)=>{const m=studio.media.add(req.body??{});void studio.autosave();res.status(201).json(m);});
  r.get("/audio",(req,res)=>res.json([...studio.audio.values()]));
  r.post("/audio",(req,res)=>{const a=createAudioTrack(req.body??{});studio.audio.set(a.id,a);void studio.autosave();res.status(201).json(a);});
  r.post("/assets",(req,res)=>{const a=studio.assets.create(req.body??{});studio.events.emit("asset.created",a);res.status(201).json(a);});
  r.get("/jobs",(req,res)=>res.json(studio.jobs.list()));
  r.post("/jobs",(req,res)=>res.status(202).json(studio.jobs.enqueue(req.body?.type,req.body?.payload,req.body)));
  r.post("/jobs/:id/run",async(req,res)=>res.json(await studio.jobs.run(req.params.id)));

  r.get("/realism",(req,res)=>res.json(studio.realism.list()));
  r.post("/realism",(req,res)=>res.status(201).json(studio.realism.create(req.body??{})));
  r.post("/realism/:id",(req,res)=>res.json(studio.realism.update(req.params.id,req.body??{})));
  r.get("/realism/:id/prompt",(req,res)=>res.json(studio.realism.promptSpec(req.params.id)));

  r.get("/research",(req,res)=>res.json(studio.research.list()));
  r.post("/research",(req,res)=>res.status(201).json(studio.research.create(req.body??{})));
  r.post("/evaluate",(req,res)=>res.json(evaluateArtifact(req.body?.artifact??{},req.body?.options??{})));
  r.get("/export",verifyApexCommander,(req,res)=>res.json(exportStudio(studio)));
  r.post("/import",verifyApexCommander,(req,res)=>res.json(importStudio(studio,req.body??{})));
  return r;
}
