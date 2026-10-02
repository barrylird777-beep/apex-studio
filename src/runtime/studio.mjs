import { KnowledgeGraph } from "../core/knowledge-graph.mjs";
import { ContinuityLedger } from "../core/continuity.mjs";
import { TimelineEngine } from "../core/timeline.mjs";
import { ProductionGraph } from "../core/production.mjs";
import { AgentOrchestrator } from "../agents/orchestrator.mjs";
import { AgentRegistry } from "../agents/registry.mjs";
import { ProjectStore } from "../core/project.mjs";
import { MemoryStore } from "../core/memory.mjs";
import { AssetRegistry } from "../assets/lineage.mjs";
import { WorldState } from "../world/state.mjs";
import { EventBus } from "../core/event-bus.mjs";
import { JobQueue } from "../core/jobs.mjs";
import { ProviderRegistry } from "../core/provider.mjs";
import { ToolRegistry } from "../agents/tool-registry.mjs";
import { SessionManager } from "./session.mjs";
import { createScene } from "../core/scene.mjs";
import { BiblicalStoryEngine } from "../biblical/story-engine.mjs";
import { JsonStore } from "../core/persistence.mjs";
import { CommandLog } from "../core/undo.mjs";
import { universalSearch } from "../core/search.mjs";
import { Metrics } from "./observability.mjs";
import { KnowledgeBase } from "../core/knowledge-base.mjs";
import { RenderQueue } from "../core/render.mjs";
import { ReleaseManager } from "../core/release.mjs";
import { CollaborationLog } from "../core/collaboration.mjs";
import { CharacterStore } from "../characters/store.mjs";
import { SourceRegistry } from "../core/sources.mjs";
import { CommandRouter } from "../core/command-router.mjs";
import { ResearchEngine } from "../core/research.mjs";
import { createPrivacyPolicy } from "../core/privacy.mjs";
import { LocalMode } from "../core/local-mode.mjs";
import { createSecretStore } from "../core/secrets.mjs";
import { EgressPolicy } from "../core/egress.mjs";
import { RealismManager } from "../core/realism.mjs";
import { MediaRegistry } from "../core/media.mjs";
import { createAudioTrack } from "../core/audio.mjs";
import { buildStoryboard } from "../core/storyboard.mjs";
import { VisualBible } from "../core/visual-bible.mjs";
import { GenerationQueue, buildVisualPrompt } from "../core/visual-generation.mjs";
import bibleCatalog from "../../data/bible/catalog.json" with { type:"json" };
import { searchBibleEdition } from "../bible/library.mjs";
import { createReleasePackage, buildYouTubeDescription, buildSubtitleCues } from "../core/release-package.mjs";
import { createRetentionOpening, buildRetentionPrompt } from "../core/retention.mjs";
import { createEpisode, buildEpisodePlan, episodeReadiness, advanceEpisode, buildEpisodeEntertainmentPrompt } from "../core/episode-factory.mjs";
import { auditEntertainment } from "../core/entertainment.mjs";
import { createTruthGraph, addEntity, addClaim, linkTruth, auditTruthGraph } from "../core/truth-graph.mjs";
import { compileEpisode, compilerStageReport } from "../core/episode-compiler.mjs";
import { episodeQualityGate } from "../core/quality-gates.mjs";
import { createDirectorPlan, directorPlan } from "../core/apex-director.mjs";
import { createWorldCanon, addCanonEntity, updateCanonEntity, relateCanon, recordCanonEvent, auditCanon, canonForEpisode, attachEpisodeToCanon } from "../core/world-canon.mjs";
import { createStoryIntelligence, addStoryEntity, addStoryEvent, addStoryClaim, addChronology, auditStoryIntelligence, storyIntelligencePrompt } from "../core/story-intelligence.mjs";

export function createStudio(options={}) {
  const events=new EventBus();
  const privacy=createPrivacyPolicy(options.privacy);
  const studio={
    version:"5.4.0",events,privacy,localMode:new LocalMode(privacy),
    egress:new EgressPolicy(options.egress),secrets:createSecretStore(),
    projects:new ProjectStore(),memory:new MemoryStore(),graph:new KnowledgeGraph(),canon:createWorldCanon(),
    continuity:new ContinuityLedger(),timelines:new TimelineEngine(),production:new ProductionGraph(),
    agents:new AgentRegistry(),orchestrator:new AgentOrchestrator(),characters:new CharacterStore(),
    sources:new SourceRegistry(),knowledgeBase:new KnowledgeBase(),research:new ResearchEngine(),
    realism:new RealismManager(),assets:new AssetRegistry(),world:new WorldState(),jobs:new JobQueue(events),
    providers:new ProviderRegistry(),tools:new ToolRegistry(),sessions:new SessionManager(),
    persistence:new JsonStore(options.persistenceFile??process.env.APEX_STATE_FILE??"./data/runtime/state.json"),
    commands:new CommandLog(),commandsRouter:new CommandRouter(),metrics:new Metrics(),render:new RenderQueue(),
    releases:new ReleaseManager(),collaboration:new CollaborationLog(),scenes:new Map(),biblical:new BiblicalStoryEngine(),media:new MediaRegistry(),audio:new Map(),visualBible:new VisualBible(),generation:new GenerationQueue(),releasePackages:new Map(),episodes:new Map(),retention:{create:createRetentionOpening,prompt:buildRetentionPrompt},bibleCatalog,bibleSearch:(version,q)=>searchBibleEdition(process.env.APEX_BIBLE_DIR||"./data/bibles",version,q),createReleasePackage:(i)=>{const x=createReleasePackage(i);studio.releasePackages.set(x.id,x);return x},buildYouTubeDescription,buildSubtitleCues
  };
  studio.biblical.sourceRegistry=studio.sources;
  studio.createScene=input=>{const scene=createScene(input);studio.scenes.set(scene.id,scene);events.emit("scene.created",scene);return scene;};
  studio.getScene=id=>studio.scenes.get(id)??null;
  studio.listScenes=()=>[...studio.scenes.values()];
  studio.autosave=()=>studio.save().catch(error=>{studio.metrics?.increment?.("persistence.error");return null;});
  studio._baseSnapshot=()=>({
    projects:studio.projects.snapshot(),memories:studio.memory.items,canon:studio.canon,agents:studio.agents.list(),
    assets:[...studio.assets.assets.values()],world:studio.world.snapshot(),scenes:studio.listScenes(),
    stories:studio.biblical.snapshot(),jobs:studio.jobs.list(),timelines:studio.timelines.snapshot(),renders:studio.render.snapshot(),media:studio.media.snapshot(),audio:[...studio.audio.values()],visualBible:studio.visualBible.snapshot(),generation:studio.generation.snapshot(),releasePackages:[...studio.releasePackages.values()],episodes:[...studio.episodes.values()],graph:studio.graph.snapshot(),
    characters:studio.characters.list(),sources:studio.sources.list(),documents:studio.knowledgeBase.list(),
    renders:studio.render.list(),releases:studio.releases.list(),collaboration:studio.collaboration.list()
  });
  studio.snapshot=()=>({...studio._baseSnapshot(),version:studio.version,privacy:{...studio.privacy},
    egressAudit:studio.egress.listAudit(),secrets:studio.secrets.exportRedacted(),
    research:studio.research.list(),realism:studio.realism.snapshot()});
  studio.search=(query,limit=30)=>universalSearch(query,[
    {type:"projects",items:studio.projects.list()},{type:"memories",items:studio.memory.items},
    {type:"assets",items:[...studio.assets.assets.values()]},{type:"scenes",items:studio.listScenes()},
    {type:"stories",items:studio.biblical.listStories()},{type:"characters",items:studio.characters.list()},
    {type:"sources",items:studio.sources.list()},{type:"documents",items:studio.knowledgeBase.list()}
  ],limit);
  studio.command=async(name,args={})=>studio.commandsRouter.dispatch(name,args);
  studio.commandsRouter
    .register("search",({query,limit=30})=>studio.search(query,limit))
    .register("create.scene",input=>studio.createScene(input))
    .register("create.story",input=>studio.biblical.createStory(input))
    .register("add.story.event",({storyId,...input})=>studio.biblical.addEvent(storyId,input))
    .register("create.character",input=>studio.characters.create(input))
    .register("create.source",input=>studio.sources.add(input))
    .register("create.document",input=>studio.knowledgeBase.addDocument(input))
    .register("queue.render",input=>studio.render.enqueue(input))
    .register("create.media",input=>studio.media.add(input))
    .register("create.audio",input=>{const a=createAudioTrack(input);studio.audio.set(a.id,a);return a;})
    .register("storyboard.build",({sceneId})=>{const scene=studio.getScene(sceneId);if(!scene)throw new Error("Scene not found");const shots=buildStoryboard(scene);scene.shots=shots.map((s,i)=>({...s,index:i}));scene.updatedAt=new Date().toISOString();return scene.shots;})
    .register("create.release",input=>studio.releases.create(input))
    .register("research.create",input=>studio.research.create(input))
    .register("realism.create",input=>studio.realism.create(input))
    .register("realism.update",({id,...input})=>studio.realism.update(id,input))
    .register("realism.prompt",({id})=>studio.realism.promptSpec(id))
    .register("episode.create",input=>{const x=createEpisode(input);studio.episodes.set(x.id,x);void studio.autosave();return x;})
    .register("episode.compile",input=>{const x=compileEpisode({...input,worldCanon:input.worldCanon??studio.canon});if(x.canonEntityIds.length)attachEpisodeToCanon(studio.canon,x.id,x.canonEntityIds);studio.episodes.set(x.id,x);void studio.autosave();return x;})
    .register("episode.direct",input=>{const x=createDirectorPlan(input);studio.episodes.set(x.episodeId,x);void studio.autosave();return x;})
    .register("episode.directReport",({id})=>{const x=studio.episodes.get(id);if(!x)throw new Error("Episode not found");return directorPlan(x);})
    .register("episode.compilerReport",({id})=>{const x=studio.episodes.get(id);if(!x)throw new Error("Episode not found");return compilerStageReport(x);})
    .register("episode.qualityGate",({id})=>{const x=studio.episodes.get(id);if(!x)throw new Error("Episode not found");return episodeQualityGate(x);})
    .register("storyIntelligence.create",input=>createStoryIntelligence(input))
    .register("storyIntelligence.entity.add",({graph,...input})=>addStoryEntity(graph,input))
    .register("storyIntelligence.event.add",({graph,...input})=>addStoryEvent(graph,input))
    .register("storyIntelligence.claim.add",({graph,...input})=>addStoryClaim(graph,input))
    .register("storyIntelligence.chronology.add",({graph,...input})=>addChronology(graph,input))
    .register("storyIntelligence.audit",graph=>auditStoryIntelligence(graph))
    .register("storyIntelligence.prompt",input=>storyIntelligencePrompt(input))
    .register("truth.create",input=>createTruthGraph(input))
    .register("truth.addEntity",({graph,...input})=>addEntity(graph,input))
    .register("truth.addClaim",({graph,...input})=>addClaim(graph,input))
    .register("truth.link",({graph,...input})=>linkTruth(graph,input))
    .register("truth.audit",graph=>auditTruthGraph(graph))
    .register("canon.entity.add",input=>{const x=addCanonEntity(studio.canon,input);void studio.autosave();return x;})
    .register("canon.entity.update",({id,...patch})=>{const x=updateCanonEntity(studio.canon,id,patch);void studio.autosave();return x;})
    .register("canon.relate",input=>{const x=relateCanon(studio.canon,input);void studio.autosave();return x;})
    .register("canon.event",input=>{const x=recordCanonEvent(studio.canon,input);void studio.autosave();return x;})
    .register("canon.audit",({episodeId}={})=>auditCanon(studio.canon,episodeId?{episodeRefs:[episodeId]}:{}))
    .register("canon.episode",({episodeId})=>canonForEpisode(studio.canon,episodeId))
    .register("canon.attachEpisode",({episodeId,entityIds=[]})=>{const x=attachEpisodeToCanon(studio.canon,episodeId,entityIds);void studio.autosave();return x;})
    .register("episode.plan",input=>{const x=buildEpisodePlan(input);studio.episodes.set(x.id,x);void studio.autosave();return x;})
    .register("episode.readiness",({id})=>{const x=studio.episodes.get(id);if(!x)throw new Error("Episode not found");return episodeReadiness(x);})
    .register("episode.entertainment",({id})=>{const x=studio.episodes.get(id);if(!x)throw new Error("Episode not found");const audit=auditEntertainment(x);x.entertainmentAudit=audit;x.updatedAt=new Date().toISOString();void studio.autosave();return audit;})
    .register("episode.entertainmentPrompt",input=>buildEpisodeEntertainmentPrompt(input))
    .register("episode.advance",({id,stage})=>{const x=studio.episodes.get(id);if(!x)throw new Error("Episode not found");const next=advanceEpisode(x,stage);studio.episodes.set(id,next);void studio.autosave();return next;});
  studio.restore=snapshot=>{
    if(!snapshot||typeof snapshot!=="object") return studio;
    studio.projects.restore(snapshot.projects??[]);
    studio.canon=createWorldCanon(snapshot.canon??{});
    for(const m of snapshot.memories??[]) studio.memory.items.push(m);
    studio.characters.restore(snapshot.characters??[]);
    studio.timelines.restore(snapshot.timelines??[]);
    studio.render.restore(snapshot.renders??[]);
    studio.media.restore(snapshot.media??[]);
    studio.audio.clear(); for(const a of snapshot.audio??[]) studio.audio.set(a.id,a);
    studio.visualBible.restore(snapshot.visualBible??{}); studio.generation.restore(snapshot.generation??[]); studio.releasePackages.clear(); for(const x of snapshot.releasePackages??[]) studio.releasePackages.set(x.id,x);
    studio.episodes.clear(); for(const x of snapshot.episodes??[]) studio.episodes.set(x.id,x);
    for(const s of snapshot.sources??[]) studio.sources.sources.set(s.id,s);
    for(const scene of snapshot.scenes??[]) studio.scenes.set(scene.id,scene);
    studio.biblical.restore(snapshot.stories??{});
    studio.realism.restore(snapshot.realism??{});
    return studio;
  };
  studio.save=async()=>studio.persistence.save(studio.snapshot());
  studio.load=async(fallback={})=>studio.restore(await studio.persistence.load(fallback));
  events.on("asset.created",asset=>{studio.memory.remember({type:"asset",projectId:asset.projectId,content:asset.name,importance:.4});void studio.autosave();});
  events.on("scene.created",()=>void studio.autosave());
  studio.jobs.register("memory.remember",payload=>studio.memory.remember(payload));
  return studio;
}
