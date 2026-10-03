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
import { auditContinuity, continuityReport, continuityPrompt } from "../core/continuity-engine.mjs";
import { createEpisodeGenome, auditEpisodeGenome, compareEpisodeGenomes, buildLearningPrompt } from "../core/episode-genome.mjs";
import { diagnoseEpisode, repairPlan, productionDoctorPrompt } from "../core/production-doctor.mjs";
import { createAutonomousPlan, nextDirectorAction, directorDecision } from "../core/autonomous-director.mjs";
import { createUniverseMemory, recordEpisode, recordThread, openThreads, universeContext, auditUniverseMemory } from "../core/universe-memory.mjs";
import { createProductionJob, planProductionJobs, runnableJobs, startJob, completeJob, failJob, blockPlan, auditProductionPlan, orchestratorDecision } from "../core/production-orchestrator.mjs";
import { createArtifact, addArtifactCheck, validateArtifact, promoteArtifact, artifactLineage, auditArtifactGraph } from "../core/artifact-provenance.mjs";
import { createWorldCanon, addCanonEntity, updateCanonEntity, relateCanon, recordCanonEvent, auditCanon, canonForEpisode, attachEpisodeToCanon } from "../core/world-canon.mjs";
import { createStoryIntelligence, addStoryEntity, addStoryEvent, addStoryClaim, addChronology, auditStoryIntelligence, storyIntelligencePrompt } from "../core/story-intelligence.mjs";
import { createStoryArchitecture, addStoryBeat, auditStoryArchitecture, buildStoryArchitecture, storyArchitecturePrompt } from "../core/story-architect.mjs";
import { createAgent, createCrew, createHandoff, queueHandoff, completeHandoff, availableAgents, requestHumanApproval, approveCrewDecision, revokeCrewApproval, canRelease, auditCrew } from "../core/agent-crew.mjs";
import { createPackagingVariant, createGrowthExperiment, recordGrowthMetrics, recordGrowthObservation, growthLearningReport, buildGrowthPrompt } from "../core/growth-engine.mjs";
import { groundPassageFromBible, resolveBiblePassage, auditSourceRefs, seedStoryIntelligenceFromHits, sourceGroundingPrompt } from "../core/source-grounding.mjs";
import { sacredTextCatalog } from "../biblical/sacred-library.mjs";
import { createQuirk, suggestQuirks, auditQuirks } from "../core/quirks.mjs";
import { SexEngine } from "../core/se-x.mjs";
import { OmniStore } from "../core/omni-store.mjs";
import { buildRiskReport, createRiskHandshake } from "../core/omni-risk.mjs";
import { parseProsody } from "../core/prosody.mjs";
import { monoCompatibleWidth } from "../core/stereo.mjs";
import { createNarrativeTrack, mapNarrativeBlock } from "../core/narrative-map.mjs";




export function createStudio(options={}) {
  const events=new EventBus();
  const privacy=createPrivacyPolicy(options.privacy);
  const studio={
    version:"5.4.0",events,privacy,localMode:new LocalMode(privacy),
    egress:new EgressPolicy(options.egress),secrets:createSecretStore(),
    projects:new ProjectStore(),memory:new MemoryStore(),graph:new KnowledgeGraph(),canon:createWorldCanon(),agentCrews:[],growthExperiments:new Map(),omniStore:new OmniStore(),sex:null,omniHandshakes:new Map(),narrativeTracks:new Map(),
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
  studio.sex=new SexEngine({egress:studio.egress,store:studio.omniStore,events});
  void studio.omniStore.init();
  studio.createScene=input=>{const scene=createScene(input);studio.scenes.set(scene.id,scene);events.emit("scene.created",scene);return scene;};
  studio.getScene=id=>studio.scenes.get(id)??null;
  studio.listScenes=()=>[...studio.scenes.values()];
  studio.autosave=()=>studio.save().catch(error=>{studio.metrics?.increment?.("persistence.error");return null;});
  studio._baseSnapshot=()=>({
    projects:studio.projects.snapshot(),memories:studio.memory.items,canon:studio.canon,agents:studio.agents.list(),
    assets:[...studio.assets.assets.values()],world:studio.world.snapshot(),scenes:studio.listScenes(),
    stories:studio.biblical.snapshot(),jobs:studio.jobs.list(),timelines:studio.timelines.snapshot(),renders:studio.render.snapshot(),media:studio.media.snapshot(),audio:[...studio.audio.values()],visualBible:studio.visualBible.snapshot(),generation:studio.generation.snapshot(),releasePackages:[...studio.releasePackages.values()],episodes:[...studio.episodes.values()],graph:studio.graph.snapshot(),
    characters:studio.characters.list(),sources:studio.sources.list(),documents:studio.knowledgeBase.snapshot(),
    renders:studio.render.list(),releases:studio.releases.list(),collaboration:studio.collaboration.list(),agentCrews:studio.agentCrews,growthExperiments:[...studio.growthExperiments.values()]
  });
  studio.snapshot=()=>({...studio._baseSnapshot(),version:studio.version,privacy:{...studio.privacy},narrativeTracks:[...studio.narrativeTracks.values()],
    egressAudit:studio.egress.listAudit(),secrets:studio.secrets.exportRedacted(),
    research:studio.research.list(),realism:studio.realism.snapshot()});
  studio.search=(query,limit=30)=>universalSearch(query,[
    {type:"projects",items:studio.projects.list()},{type:"memories",items:studio.memory.items},
    {type:"assets",items:[...studio.assets.assets.values()]},{type:"scenes",items:studio.listScenes()},
    {type:"stories",items:studio.biblical.listStories()},{type:"characters",items:studio.characters.list()},
    {type:"sources",items:studio.sources.list()},{type:"documents",items:studio.knowledgeBase.list()}
  ],limit);
  studio.omniRisk=(input={})=>buildRiskReport(input);
  studio.beginOmniReview=(input={})=>{const h=createRiskHandshake(studio.omniRisk(input));studio.omniHandshakes.set(h.id,h);return h;};
  studio.confirmOmniReview=(id,approved)=>{const h=studio.omniHandshakes.get(id);if(!h)throw new Error("Risk review not found");h.state=approved===true?"approved":"cancelled";h.decidedAt=new Date().toISOString();return h;};
  studio.command=async(name,args={})=>studio.commandsRouter.dispatch(name,args);
  studio.commandsRouter
    .register("search",({query,limit=30})=>studio.search(query,limit))
    .register("omni.risk",input=>buildRiskReport(input))
    .register("omni.prosody",input=>parseProsody(input.text))
    .register("omni.stereo",input=>monoCompatibleWidth(input))
    .register("narrative.create",input=>{const x=createNarrativeTrack(input);studio.narrativeTracks.set(x.id,x);void studio.omniStore.append("narrative_tracks",x);return x;})
    .register("narrative.block",({trackId,...block})=>{const x=studio.narrativeTracks.get(trackId);if(!x)throw new Error("Narrative track not found");mapNarrativeBlock(x,block);void studio.omniStore.append("narrative_tracks",x);return x;})
    .register("timeline.node.create",input=>studio.omniStore.createProductionTimeline(input))
    .register("timeline.mutation.create",input=>studio.omniStore.createTimelineMutation(input))
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
    .register("storyIntelligence.prompt",input=>storyIntelligencePrompt(input)).register("storyArchitecture.create",input=>createStoryArchitecture(input))
    .register("storyArchitecture.build",input=>buildStoryArchitecture(input))
    .register("storyArchitecture.beat.add",({architecture,...input})=>addStoryBeat(architecture,input))
    .register("storyArchitecture.audit",architecture=>auditStoryArchitecture(architecture))
    .register("storyArchitecture.prompt",input=>storyArchitecturePrompt(input))
    .register("truth.create",input=>createTruthGraph(input))
    .register("truth.addEntity",({graph,...input})=>addEntity(graph,input))
    .register("truth.addClaim",({graph,...input})=>addClaim(graph,input))
    .register("truth.link",({graph,...input})=>linkTruth(graph,input))
    .register("artifact.create",input=>createArtifact(input))
    .register("artifact.check",input=>addArtifactCheck(input.artifact,input.check))
    .register("artifact.validate",artifact=>validateArtifact(artifact))
    .register("artifact.promote",input=>promoteArtifact(input.artifact,input.status))
    .register("artifact.lineage",input=>artifactLineage(input.artifact,input.artifacts))
    .register("artifact.audit",artifacts=>auditArtifactGraph(artifacts))
    .register("orchestrator.plan",input=>planProductionJobs(input))
    .register("orchestrator.job.create",input=>createProductionJob(input))
    .register("orchestrator.runnable",input=>runnableJobs(input.plan,input.completedIds))
    .register("orchestrator.job.start",job=>startJob(job))
    .register("orchestrator.job.complete",input=>completeJob(input.job,input.output,input.validation))
    .register("orchestrator.job.fail",input=>failJob(input.job,input.error))
    .register("orchestrator.block",input=>blockPlan(input.plan,input.reason))
    .register("orchestrator.audit",plan=>auditProductionPlan(plan))
    .register("orchestrator.decision",input=>orchestratorDecision(input))
    .register("universe.create",input=>createUniverseMemory(input))
    .register("universe.recordEpisode",input=>recordEpisode(input.memory,input.episode))
    .register("universe.recordThread",input=>recordThread(input.memory,input.thread))
    .register("universe.openThreads",memory=>openThreads(memory))
    .register("universe.context",input=>universeContext(input.memory,input.query))
    .register("universe.audit",memory=>auditUniverseMemory(memory))
    .register("director.autonomousPlan",input=>createAutonomousPlan(input))
    .register("director.nextAction",plan=>nextDirectorAction(plan))
    .register("director.decision",input=>directorDecision(input))
    .register("crew.create",input=>{const x=createCrew(input);studio.agentCrews.push(x);return x;})
    .register("crew.agent.create",input=>createAgent(input))
    .register("crew.handoff.create",input=>createHandoff(input))
    .register("crew.handoff.queue",input=>queueHandoff(input.crew,input.handoff))
    .register("crew.handoff.complete",input=>completeHandoff(input.crew,input.handoffId,input.result))
    .register("crew.available",crew=>availableAgents(crew))
    .register("crew.audit",crew=>auditCrew(crew))
    .register("crew.approval.request",input=>requestHumanApproval(input.crew,input))
    .register("crew.approval.approve",input=>approveCrewDecision(input.crew,input))
    .register("crew.approval.revoke",input=>revokeCrewApproval(input.crew,input.reason))
    .register("crew.canRelease",crew=>canRelease(crew))
    .register("growth.variant.create",input=>createPackagingVariant(input))
    .register("growth.experiment.create",input=>{const x=createGrowthExperiment(input);studio.growthExperiments.set(x.id,x);return x;})
    .register("growth.metrics.record",input=>{const x=recordGrowthMetrics(studio.growthExperiments.get(input.id),input.metrics);studio.growthExperiments.set(x.id,x);return x;})
    .register("growth.observation.record",input=>{const x=recordGrowthObservation(studio.growthExperiments.get(input.id),input.observation);studio.growthExperiments.set(x.id,x);return x;})
    .register("growth.report",({id})=>growthLearningReport(studio.growthExperiments.get(id)))
    .register("growth.prompt",input=>buildGrowthPrompt(input))
    .register("command.center",async()=>{
      const episodes=[...studio.episodes.values()];
      const crews=studio.agentCrews??[];
      const growth=[...studio.growthExperiments.values()];
      const blockers=await Promise.all(
        episodes.map(async e=>({id:e.id,gate:await studio.command("episode.qualityGate",{id:e.id})}))
      );
      return {
        version:studio.version,
        episodes:episodes.map(e=>({id:e.id,title:e.title,stage:e.stage,readiness:e.readiness})),
        blockers,
        crews:crews.map(c=>({id:c.id,episodeId:c.episodeId,agents:c.agents.length,approval:c.approval})),
        growth:growth.map(x=>({id:x.id,episodeId:x.episodeId,metrics:x.metrics,observations:x.observations.length})),
        humanAuthority:{finalDecisionRequired:true,releaseRequiresApproval:true}
      };
    })
    .register("sacred.catalog",()=>sacredTextCatalog())
    .register("quirk.create",input=>createQuirk(input))
    .register("quirk.suggest",input=>suggestQuirks(input))
    .register("quirk.audit",quirks=>auditQuirks(quirks))
    .register("source.ground",input=>groundPassageFromBible(input.root,input.slug,input.query,input))
    .register("source.resolvePassage",input=>resolveBiblePassage(input.root,input.slug,input.passage,input))
    .register("source.auditRefs",input=>auditSourceRefs(input.sourceRefs))
    .register("source.seedStory",input=>seedStoryIntelligenceFromHits(input))
    .register("source.prompt",input=>sourceGroundingPrompt(input))
    .register("doctor.diagnose",input=>diagnoseEpisode(input))
    .register("doctor.repairPlan",diagnosis=>repairPlan(diagnosis))
    .register("doctor.prompt",input=>productionDoctorPrompt(input))
    .register("genome.create",input=>createEpisodeGenome(input))
    .register("genome.audit",genome=>auditEpisodeGenome(genome))
    .register("genome.compare",input=>compareEpisodeGenomes(input.current,input.history))
    .register("genome.learningPrompt",input=>buildLearningPrompt(input))
    .register("continuity.audit",input=>auditContinuity(input))
    .register("continuity.report",input=>continuityReport(input))
    .register("continuity.prompt",input=>continuityPrompt(input))
    .register("truth.audit",graph=>auditTruthGraph(graph))
    .register("storyArchitecture.create",input=>createStoryArchitecture(input))
    .register("storyArchitecture.build",input=>buildStoryArchitecture(input))
    .register("storyArchitecture.beat.add",({architecture,...input})=>addStoryBeat(architecture,input))
    .register("storyArchitecture.audit",architecture=>auditStoryArchitecture(architecture))
    .register("storyArchitecture.prompt",input=>storyArchitecturePrompt(input))
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
    studio.world.restore(snapshot.world??{});
    studio.canon=createWorldCanon(snapshot.canon??{});
    studio.memory.items=Array.isArray(snapshot.memories)?structuredClone(snapshot.memories):[];
    studio.characters.restore(snapshot.characters??[]);
    studio.sources.restore(snapshot.sources??[]);
    studio.knowledgeBase.restore(snapshot.documents??{});
    studio.timelines.restore(snapshot.timelines??[]);
    studio.render.restore(snapshot.renders??[]);
    studio.media.restore(snapshot.media??[]);
    studio.assets.assets.clear(); for(const a of snapshot.assets??[]) studio.assets.assets.set(a.id,a);
    studio.jobs.jobs.clear(); for(const j of snapshot.jobs??[]) studio.jobs.jobs.set(j.id,j);
    studio.audio.clear(); for(const a of snapshot.audio??[]) studio.audio.set(a.id,a);
    studio.visualBible.restore(snapshot.visualBible??{}); studio.generation.restore(snapshot.generation??[]); studio.releasePackages.clear(); for(const x of snapshot.releasePackages??[]) studio.releasePackages.set(x.id,x);
    studio.episodes.clear(); for(const x of snapshot.episodes??[]) studio.episodes.set(x.id,x);
    studio.releases.restore(snapshot.releases??[]);
    studio.collaboration.restore(snapshot.collaboration??[]);
    studio.graph=new KnowledgeGraph(snapshot.graph??{entities:[],relations:[]});
    studio.agentCrews=Array.isArray(snapshot.agentCrews)?snapshot.agentCrews:[];
    studio.growthExperiments=new Map((snapshot.growthExperiments??[]).map(x=>[x.id,x]));
    studio.narrativeTracks=new Map((snapshot.narrativeTracks??[]).map(x=>[x.id,x]));
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
