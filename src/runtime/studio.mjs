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
import { JsonStore } from "../core/persistence.mjs";
import { CommandLog } from "../core/undo.mjs";
import { universalSearch } from "../core/search.mjs";
import { Metrics } from "./observability.mjs";
import { KnowledgeBase } from "../core/knowledge-base.mjs";
import { RenderQueue } from "../core/render.mjs";
import { ReleaseManager } from "../core/release.mjs";
import { CollaborationLog } from "../core/collaboration.mjs";
import { SourceRegistry } from "../core/sources.mjs";
import { CommandRouter } from "../core/command-router.mjs";
import { ResearchEngine } from "../core/research.mjs";
import { createPrivacyPolicy } from "../core/privacy.mjs";
import { LocalMode } from "../core/local-mode.mjs";
import { createSecretStore } from "../core/secrets.mjs";
import { EgressPolicy } from "../core/egress.mjs";
import { MediaRegistry } from "../core/media.mjs";
import { createAudioTrack } from "../core/audio.mjs";
import { GenerationQueue, buildVisualPrompt } from "../core/visual-generation.mjs";
import bibleCatalog from "../../data/bible/catalog.json" with { type:"json" };
import { searchBibleEdition } from "../bible/library.mjs";
import { createReleasePackage, buildYouTubeDescription, buildSubtitleCues } from "../core/release-package.mjs";
import { createRetentionOpening, buildRetentionPrompt } from "../core/retention.mjs";
import { auditEntertainment } from "../core/entertainment.mjs";
import { createProductionJob, planProductionJobs, runnableJobs, startJob, completeJob, failJob, blockPlan, auditProductionPlan, orchestratorDecision } from "../core/production-orchestrator.mjs";
import { createArtifact, addArtifactCheck, validateArtifact, promoteArtifact, artifactLineage, auditArtifactGraph } from "../core/artifact-provenance.mjs";
import { createAgent, createCrew, createHandoff, queueHandoff, completeHandoff, availableAgents, requestHumanApproval, approveCrewDecision, revokeCrewApproval, canRelease, auditCrew } from "../core/agent-crew.mjs";
import { createPackagingVariant, createGrowthExperiment, recordGrowthMetrics, recordGrowthObservation, growthLearningReport, buildGrowthPrompt } from "../core/growth-engine.mjs";
import { SexEngine } from "../core/se-x.mjs";
import { OmniStore } from "../core/omni-store.mjs";
import { buildRiskReport, createRiskHandshake } from "../core/omni-risk.mjs";
import { parseProsody } from "../core/prosody.mjs";
import { monoCompatibleWidth } from "../core/stereo.mjs";




export function createStudio(options={}) {
  const events=new EventBus();
  const privacy=createPrivacyPolicy(options.privacy);
  const studio={
    version:"5.4.0",events,privacy,localMode:new LocalMode(privacy),
    egress:new EgressPolicy(options.egress),secrets:createSecretStore(),
    continuity:new ContinuityLedger(),timelines:new TimelineEngine(),production:new ProductionGraph(),
    sources:new SourceRegistry(),knowledgeBase:new KnowledgeBase(),research:new ResearchEngine(),
    providers:new ProviderRegistry(),tools:new ToolRegistry(),sessions:new SessionManager(),
    persistence:new JsonStore(options.persistenceFile??process.env.APEX_STATE_FILE??"./data/runtime/state.json"),
    commands:new CommandLog(),commandsRouter:new CommandRouter(),metrics:new Metrics(),render:new RenderQueue(),
  };
  studio.sex=new SexEngine({egress:studio.egress,store:studio.omniStore,events});
  void studio.omniStore.init();
  studio.autosave=()=>studio.save().catch(error=>{studio.metrics?.increment?.("persistence.error");return null;});
  studio._baseSnapshot=()=>({
    projects:studio.projects.snapshot(),memories:studio.memory.items,canon:studio.canon,agents:studio.agents.list(),
    renders:studio.render.list(),releases:studio.releases.list(),collaboration:studio.collaboration.list(),agentCrews:studio.agentCrews,growthExperiments:[...studio.growthExperiments.values()]
  });
    egressAudit:studio.egress.listAudit(),secrets:studio.secrets.exportRedacted(),
  studio.search=(query,limit=30)=>universalSearch(query,[
    {type:"projects",items:studio.projects.list()},{type:"memories",items:studio.memory.items},
    {type:"assets",items:[...studio.assets.assets.values()]},
    
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
    .register("timeline.node.create",input=>studio.omniStore.createProductionTimeline(input))
    .register("timeline.mutation.create",input=>studio.omniStore.createTimelineMutation(input))
    .register("create.story",input=>studio.biblical.createStory(input))
    .register("add.story.event",({storyId,...input})=>studio.biblical.addEvent(storyId,input))
    .register("create.character",input=>studio.characters.create(input))
    .register("create.source",input=>studio.sources.add(input))
    .register("create.document",input=>studio.knowledgeBase.addDocument(input))
    .register("queue.render",input=>studio.render.enqueue(input))
    .register("create.media",input=>studio.media.add(input))
    .register("create.audio",input=>{const a=createAudioTrack(input);studio.audio.set(a.id,a);return a;})
    .register("create.release",input=>studio.releases.create(input))
    .register("research.create",input=>studio.research.create(input))
    .register("realism.create",input=>studio.realism.create(input))
    .register("realism.update",({id,...input})=>studio.realism.update(id,input))
    .register("realism.prompt",({id})=>studio.realism.promptSpec(id))
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
    .register("source.auditRefs",input=>auditSourceRefs(input.sourceRefs))
    .register("episode.entertainment",({id})=>{const x=studio.episodes.get(id);if(!x)throw new Error("Episode not found");const audit=auditEntertainment(x);x.entertainmentAudit=audit;x.updatedAt=new Date().toISOString();void studio.autosave();return audit;})
  studio.restore=snapshot=>{
    if(!snapshot||typeof snapshot!=="object") return studio;
    studio.projects.restore(snapshot.projects??[]);
    studio.world.restore(snapshot.world??{});
    studio.memory.items=Array.isArray(snapshot.memories)?structuredClone(snapshot.memories):[];
    studio.sources.restore(snapshot.sources??[]);
    studio.knowledgeBase.restore(snapshot.documents??{});
    studio.timelines.restore(snapshot.timelines??[]);
    studio.render.restore(snapshot.renders??[]);
    studio.media.restore(snapshot.media??[]);
    studio.assets.assets.clear(); for(const a of snapshot.assets??[]) studio.assets.assets.set(a.id,a);
    studio.jobs.jobs.clear(); for(const j of snapshot.jobs??[]) studio.jobs.jobs.set(j.id,j);
    studio.audio.clear(); for(const a of snapshot.audio??[]) studio.audio.set(a.id,a);
    studio.releases.restore(snapshot.releases??[]);
    studio.collaboration.restore(snapshot.collaboration??[]);
    studio.graph=new KnowledgeGraph(snapshot.graph??{entities:[],relations:[]});
    studio.agentCrews=Array.isArray(snapshot.agentCrews)?snapshot.agentCrews:[];
    studio.growthExperiments=new Map((snapshot.growthExperiments??[]).map(x=>[x.id,x]));
    for(const s of snapshot.sources??[]) studio.sources.sources.set(s.id,s);
    for(const scene of snapshot.scenes??[]) studio.scenes.set(scene.id,scene);
    return studio;
  };
  studio.save=async()=>studio.persistence.save(studio.snapshot());
  studio.load=async(fallback={})=>studio.restore(await studio.persistence.load(fallback));
  events.on("asset.created",asset=>{studio.memory.remember({type:"asset",projectId:asset.projectId,content:asset.name,importance:.4});void studio.autosave();});
  events.on("scene.created",()=>void studio.autosave());
  studio.jobs.register("memory.remember",payload=>studio.memory.remember(payload));
  return studio;
}
