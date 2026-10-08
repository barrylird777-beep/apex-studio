import { KnowledgeGraph } from "../core/knowledge-graph.mjs";
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
import { GenerationQueue } from "../core/visual-generation.mjs";
import { createReleasePackage, buildYouTubeDescription, buildSubtitleCues } from "../core/release-package.mjs";
import { createRetentionOpening, buildRetentionPrompt } from "../core/retention.mjs";
import { createProductionJob, planProductionJobs, runnableJobs, startJob, completeJob, failJob, blockPlan, auditProductionPlan, orchestratorDecision } from "../core/production-orchestrator.mjs";
import { createArtifact, addArtifactCheck, validateArtifact, promoteArtifact, artifactLineage, auditArtifactGraph } from "../core/artifact-provenance.mjs";
import { createApexIntelligenceRuntime } from "../agents/apex-intelligence-runtime.mjs";
import { createAgent, createCrew, createHandoff, queueHandoff, completeHandoff, availableAgents, requestHumanApproval, approveCrewDecision, revokeCrewApproval, canRelease, auditCrew } from "../core/agent-crew.mjs";
import { createPackagingVariant, createGrowthExperiment, recordGrowthMetrics, recordGrowthObservation, growthLearningReport, buildGrowthPrompt } from "../core/growth-engine.mjs";
import { SexEngine } from "../core/se-x.mjs";
import { OmniStore } from "../core/omni-store.mjs";
import { buildRiskReport, createRiskHandshake } from "../core/omni-risk.mjs";
import { parseProsody } from "../core/prosody.mjs";
import { monoCompatibleWidth } from "../core/stereo.mjs";
import { createEditorProject, addTrack, addClip, addKeyframe, addEffect, addCaption, addMarker, setTransition, createExportPlan, validateEditorProject, trimClip, splitClip, moveClip, removeClip, snapshotEditor, restoreEditor, setTrackState, addTrackGroup, toggleTrackGroup, snapTime, moveClipSnapped } from "../core/editor-engine.mjs";

export function createStudio(options={}) {
  const events=new EventBus();
  const privacy=createPrivacyPolicy(options.privacy);
  const studio={
    version:"5.4.1",events,privacy,localMode:new LocalMode(privacy),
    egress:new EgressPolicy(options.egress),secrets:createSecretStore(),
    projects:new ProjectStore(),memory:new MemoryStore(),graph:new KnowledgeGraph(),
    agentCrews:[],growthExperiments:new Map(),omniStore:new OmniStore(),omniHandshakes:new Map(),
    timelines:new TimelineEngine(),production:new ProductionGraph(),
    agents:new AgentRegistry(),orchestrator:new AgentOrchestrator(),
    sources:new SourceRegistry(),knowledgeBase:new KnowledgeBase(),research:new ResearchEngine(),
    assets:new AssetRegistry(),world:new WorldState(),jobs:new JobQueue(events),
    intelligence:null,
    providers:new ProviderRegistry(),tools:new ToolRegistry(),sessions:new SessionManager(),
    persistence:new JsonStore(options.persistenceFile??process.env.APEX_STATE_FILE??"./data/runtime/state.json"),
    commands:new CommandLog(),commandsRouter:new CommandRouter(),metrics:new Metrics(),render:new RenderQueue(),
    releases:new ReleaseManager(),collaboration:new CollaborationLog(),media:new MediaRegistry(),audio:new Map(),
    generation:new GenerationQueue(),releasePackages:new Map(),
    retention:{create:createRetentionOpening,prompt:buildRetentionPrompt},
    createReleasePackage:(input)=>{const x=createReleasePackage(input);studio.releasePackages.set(x.id,x);return x},
    buildYouTubeDescription,buildSubtitleCues
  };
  studio.sex=new SexEngine({egress:studio.egress,store:studio.omniStore,events});
  studio.intelligence=createApexIntelligenceRuntime({
    memory:studio.memory,
    events,
    persistence: async value => {
      studio.memory.remember({
        type: "intelligence-run",
        projectId: value?.plan?.context?.projectId ?? null,
        content: JSON.stringify(value),
        importance: value?.status === "complete" ? 0.9 : 0.65
      });
      return value;
    }
  });
  void studio.omniStore.init().catch(error => {
    events.emit("omni.database.unavailable", { error: String(error?.message || error).slice(0, 500) });
  });
  studio.search=(query,limit=30)=>universalSearch(query,[
    {type:"projects",items:studio.projects.list()},
    {type:"memories",items:studio.memory.items},
    {type:"assets",items:[...studio.assets.assets.values()]},
    {type:"sources",items:studio.sources.list()},
    {type:"documents",items:studio.knowledgeBase.list()}
  ],limit);
  studio.omniRisk=(input={})=>buildRiskReport(input);
  studio.beginOmniReview=(input={})=>{const h=createRiskHandshake(studio.omniRisk(input));studio.omniHandshakes.set(h.id,h);return h};
  studio.confirmOmniReview=(id,approved)=>{const h=studio.omniHandshakes.get(id);if(!h)throw new Error("Risk review not found");h.state=approved===true?"approved":"cancelled";h.decidedAt=new Date().toISOString();return h};
  studio.command=async(name,args={})=>studio.commandsRouter.dispatch(name,args);
  studio.commandsRouter
    .register("search",({query,limit=30})=>studio.search(query,limit))
    .register("intelligence.run",({goal,context={}})=>studio.intelligence.run(goal,context))
    .register("intelligence.queue",({goal,context={}})=>studio.intelligence.enqueueDurable(goal,context))
    .register("omni.risk",input=>buildRiskReport(input))
    .register("omni.prosody",input=>parseProsody(input.text))
    .register("omni.stereo",input=>monoCompatibleWidth(input))
    .register("timeline.node.create",input=>studio.omniStore.createProductionTimeline(input))
    .register("timeline.mutation.create",input=>studio.omniStore.createTimelineMutation(input))
    .register("create.source",input=>studio.sources.add(input))
    .register("create.document",input=>studio.knowledgeBase.addDocument(input))
    .register("queue.render",input=>studio.render.enqueue(input))
    .register("create.media",input=>studio.media.add(input))
    .register("create.audio",input=>{const a=createAudioTrack(input);studio.audio.set(a.id,a);return a})
    .register("create.release",input=>studio.releases.create(input))
    .register("research.create",input=>studio.research.create(input))
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
    .register("crew.create",input=>{const x=createCrew(input);studio.agentCrews.push(x);return x})
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
    .register("growth.experiment.create",input=>{const x=createGrowthExperiment(input);studio.growthExperiments.set(x.id,x);return x})
    .register("growth.metrics.record",input=>{const x=recordGrowthMetrics(studio.growthExperiments.get(input.id),input.metrics);studio.growthExperiments.set(x.id,x);return x})
    .register("growth.observation.record",input=>{const x=recordGrowthObservation(studio.growthExperiments.get(input.id),input.observation);studio.growthExperiments.set(x.id,x);return x})
    .register("growth.report",({id})=>growthLearningReport(studio.growthExperiments.get(id)))
    .register("growth.prompt",input=>buildGrowthPrompt(input))
    .register("editor.project.create",input=>createEditorProject(input))
    .register("editor.track.add",input=>addTrack(input.project,input.type,input.name))
    .register("editor.clip.add",input=>addClip(input.project,input.trackId,input))
    .register("editor.keyframe.add",input=>addKeyframe(input.project,input.trackId,input.clipId,input))
    .register("editor.effect.add",input=>addEffect(input.project,input.trackId,input.clipId,input.effect||input))
    .register("editor.caption.add",input=>addCaption(input.project,input))
    .register("editor.marker.add",input=>addMarker(input.project,input))
    .register("editor.transition.set",input=>setTransition(input.project,input.trackId,input.clipId,input.edge,input.type,input.duration))
    .register("editor.clip.trim",input=>trimClip(input.project,input.trackId,input.clipId,input))
    .register("editor.clip.split",input=>splitClip(input.project,input.trackId,input.clipId,input.time))
    .register("editor.clip.move",input=>moveClip(input.project,input.trackId,input.clipId,input.start,input))
    .register("editor.clip.remove",input=>removeClip(input.project,input.trackId,input.clipId,input))
    .register("editor.clip.moveSnapped",input=>moveClipSnapped(input.project,input.trackId,input.clipId,input.start,input))
    .register("editor.track.state",input=>setTrackState(input.project,input.trackId,input))
    .register("editor.track.group.create",input=>addTrackGroup(input.project,input.name,input.trackIds))
    .register("editor.track.group.toggle",input=>toggleTrackGroup(input.project,input.groupId,input.collapsed))
    .register("editor.timeline.snap",input=>snapTime(input.project,input.time,input))
    .register("editor.snapshot",project=>snapshotEditor(project))
    .register("editor.restore",input=>restoreEditor(input.project,input.snapshot))
    .register("editor.export.plan",input=>createExportPlan(input.project,input))
    .register("editor.validate",project=>validateEditorProject(project))
    .register("command.center",()=>({
    version:studio.version,
    projects:studio.projects.list().length,
    jobs:studio.jobs.list().length,
    renders:studio.render.list().length,
    research:studio.research.list().length,
    assets:studio.assets.assets.size,
    growthExperiments:studio.growthExperiments.size,
    intelligence:{
      available:typeof studio.intelligence?.run==="function",
      durableSubmission:typeof studio.intelligence?.enqueueDurable==="function",
      specialistCount:studio.intelligence?.specialists?.length ?? 0,
      verifierCount:studio.intelligence?.verifiers?.length ?? 0
    },
    humanAuthority:{finalDecisionRequired:true}
  }));
  studio._baseSnapshot=()=>({
    projects:studio.projects.snapshot(),memories:studio.memory.items,agents:studio.agents.list(),
    assets:[...studio.assets.assets.values()],world:studio.world.snapshot(),jobs:studio.jobs.list(),
    timelines:studio.timelines.snapshot(),renders:studio.render.list(),media:studio.media.snapshot(),
    audio:[...studio.audio.values()],releasePackages:[...studio.releasePackages.values()],graph:studio.graph.snapshot(),
    sources:studio.sources.list(),documents:studio.knowledgeBase.snapshot(),
    releases:studio.releases.list(),collaboration:studio.collaboration.list(),agentCrews:studio.agentCrews,
    growthExperiments:[...studio.growthExperiments.values()]
  });
  studio.snapshot=()=>({...studio._baseSnapshot(),version:studio.version,privacy:{...studio.privacy},
    egressAudit:studio.egress.listAudit(),secrets:studio.secrets.exportRedacted(),research:studio.research.list()});
  studio.restore=snapshot=>{
    if(!snapshot||typeof snapshot!=="object")return studio;
    studio.projects.restore(snapshot.projects??[]);
    studio.world.restore(snapshot.world??{});
    studio.memory.items=Array.isArray(snapshot.memories)?structuredClone(snapshot.memories):[];
    studio.sources.restore(snapshot.sources??[]);
    studio.knowledgeBase.restore(snapshot.documents??{});
    studio.timelines.restore(snapshot.timelines??[]);
    studio.render.restore(snapshot.renders??[]);
    studio.media.restore(snapshot.media??[]);
    studio.assets.assets.clear();for(const a of snapshot.assets??[])studio.assets.assets.set(a.id,a);
    studio.jobs.jobs.clear();for(const j of snapshot.jobs??[])studio.jobs.jobs.set(j.id,j);
    studio.audio.clear();for(const a of snapshot.audio??[])studio.audio.set(a.id,a);
    studio.releases.restore(snapshot.releases??[]);
    studio.collaboration.restore(snapshot.collaboration??[]);
    studio.graph=new KnowledgeGraph(snapshot.graph??{entities:[],relations:[]});
    studio.agentCrews=Array.isArray(snapshot.agentCrews)?snapshot.agentCrews:[];
    studio.growthExperiments=new Map((snapshot.growthExperiments??[]).map(x=>[x.id,x]));
    return studio;
  };
  studio.save=async()=>studio.persistence.save(studio.snapshot());
  studio.autosave=()=>studio.save().catch(error=>{studio.metrics?.increment?.("persistence.error");return null});
  studio.load=async(fallback={})=>studio.restore(await studio.persistence.load(fallback));
  studio.jobs.register("memory.remember",payload=>studio.memory.remember(payload));
  events.on("asset.created",asset=>{studio.memory.remember({type:"asset",projectId:asset.projectId,content:asset.name,importance:.4});void studio.autosave()});
  return studio;
}
