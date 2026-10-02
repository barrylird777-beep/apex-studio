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

export function createStudio(options={}) {
  const events=new EventBus();
  const privacy=createPrivacyPolicy(options.privacy);
  const studio={
    version:"5.3.0",events,privacy,localMode:new LocalMode(privacy),
    egress:new EgressPolicy(options.egress),secrets:createSecretStore(),
    projects:new ProjectStore(),memory:new MemoryStore(),graph:new KnowledgeGraph(),
    continuity:new ContinuityLedger(),timelines:new TimelineEngine(),production:new ProductionGraph(),
    agents:new AgentRegistry(),orchestrator:new AgentOrchestrator(),characters:new CharacterStore(),
    sources:new SourceRegistry(),knowledgeBase:new KnowledgeBase(),research:new ResearchEngine(),
    realism:new RealismManager(),assets:new AssetRegistry(),world:new WorldState(),jobs:new JobQueue(events),
    providers:new ProviderRegistry(),tools:new ToolRegistry(),sessions:new SessionManager(),
    persistence:new JsonStore(options.persistenceFile??process.env.APEX_STATE_FILE??"./data/runtime/state.json"),
    commands:new CommandLog(),commandsRouter:new CommandRouter(),metrics:new Metrics(),render:new RenderQueue(),
    releases:new ReleaseManager(),collaboration:new CollaborationLog(),scenes:new Map(),biblical:new BiblicalStoryEngine()
  };
  studio.biblical.sourceRegistry=studio.sources;
  studio.createScene=input=>{const scene=createScene(input);studio.scenes.set(scene.id,scene);events.emit("scene.created",scene);return scene;};
  studio.getScene=id=>studio.scenes.get(id)??null;
  studio.listScenes=()=>[...studio.scenes.values()];
  studio.autosave=()=>studio.save().catch(error=>{studio.metrics?.increment?.("persistence.error");return null;});
  studio._baseSnapshot=()=>({
    projects:studio.projects.snapshot(),memories:studio.memory.items,agents:studio.agents.list(),
    assets:[...studio.assets.assets.values()],world:studio.world.snapshot(),scenes:studio.listScenes(),
    stories:studio.biblical.snapshot(),jobs:studio.jobs.list(),timelines:studio.timelines.snapshot(),renders:studio.render.snapshot(),graph:studio.graph.snapshot(),
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
    .register("create.release",input=>studio.releases.create(input))
    .register("research.create",input=>studio.research.create(input))
    .register("realism.create",input=>studio.realism.create(input))
    .register("realism.update",({id,...input})=>studio.realism.update(id,input))
    .register("realism.prompt",({id})=>studio.realism.promptSpec(id));
  studio.restore=snapshot=>{
    if(!snapshot||typeof snapshot!=="object") return studio;
    studio.projects.restore(snapshot.projects??[]);
    for(const m of snapshot.memories??[]) studio.memory.items.push(m);
    studio.characters.restore(snapshot.characters??[]);
    studio.timelines.restore(snapshot.timelines??[]);
    studio.render.restore(snapshot.renders??[]);
    for(const s of snapshot.sources??[]) studio.sources.sources.set(s.id,s);
    for(const scene of snapshot.scenes??[]) studio.scenes.set(scene.id,scene);
    studio.biblical.restore(snapshot.stories??{});
    studio.realism.restore(snapshot.realism??{});
    return studio;
  };
  studio.save=async()=>studio.persistence.save(studio.snapshot());
  studio.load=async(fallback={})=>studio.restore(await studio.persistence.load(fallback));
  events.on("asset.created",asset=>studio.memory.remember({type:"asset",projectId:asset.projectId,content:asset.name,importance:.4}));
  studio.jobs.register("memory.remember",payload=>studio.memory.remember(payload));
  return studio;
}
