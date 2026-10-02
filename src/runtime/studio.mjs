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
import { UniverseScale } from "../core/universe.mjs";
import { JobQueue } from "../core/jobs.mjs";
import { ProviderRegistry } from "../core/provider.mjs";
import { ToolRegistry } from "../agents/tool-registry.mjs";
import { SessionManager } from "./session.mjs";
import { createScene } from "../core/scene.mjs";
import { BiblicalStoryEngine } from "../biblical/story-engine.mjs";
import { TORAH_BOOKS, TORAH_TRADITIONS } from "../biblical/torah.mjs";
import { JsonStore } from "../core/persistence.mjs";
import { CommandLog } from "../core/undo.mjs";
import { universalSearch } from "../core/search.mjs";
import { Metrics } from "./observability.mjs";
import { KnowledgeBase } from "../core/knowledge-base.mjs";
import { RenderQueue } from "../core/render.mjs";
import { ReleaseManager } from "../core/release.mjs";
import { CollaborationLog } from "../core/collaboration.mjs";
import { EmbeddingIndex } from "../core/embedding.mjs";
import { CharacterStore } from "../characters/store.mjs";
import { SourceRegistry } from "../core/sources.mjs";
import { CommandRouter } from "../core/command-router.mjs";
import { createPrivacyPolicy } from "../core/privacy.mjs";
import { LocalMode } from "../core/local-mode.mjs";
import { createSecretStore } from "../core/secrets.mjs";
import { EgressPolicy } from "../core/egress.mjs";
import { LocalAuth } from "../core/auth.mjs";
import { StrategyEngine } from "../core/strategy-engine.mjs";
import { DecisionEngine } from "../core/decision-engine.mjs";
import { ResearchEngine } from "../core/research.mjs";
import { MatureContentManager } from "../core/mature-content.mjs";
import { CompanionManager } from "../core/companion.mjs";
import { PresenceManager } from "../core/presence.mjs";
import { AdaptiveIntimacyManager } from "../core/adaptive-intimacy.mjs";
export function createStudio(options={}){
 const events=new EventBus(),privacy=createPrivacyPolicy(options.privacy);
 const studio={version:"5.0.0",events,privacy,localMode:new LocalMode(privacy),egress:new EgressPolicy(options.egress),auth:new LocalAuth(),secrets:createSecretStore(),strategy:new StrategyEngine(),decisions:new DecisionEngine(),research:new ResearchEngine(),mature:new MatureContentManager({passcode:options.layersPasscode??process.env.APEX_LAYERS_PASSCODE}),companions:new CompanionManager(),presence:new PresenceManager(),adaptiveIntimacy:new AdaptiveIntimacyManager(),projects:new ProjectStore(),memory:new MemoryStore(),graph:new KnowledgeGraph(),continuity:new ContinuityLedger(),timelines:new TimelineEngine(),production:new ProductionGraph(),agents:new AgentRegistry(),characters:new CharacterStore(),sources:new SourceRegistry(),commandsRouter:new CommandRouter(),knowledgeBase:new KnowledgeBase(),render:new RenderQueue(),releases:new ReleaseManager(),collaboration:new CollaborationLog(),embeddings:new EmbeddingIndex(),orchestrator:new AgentOrchestrator(),assets:new AssetRegistry(),world:new WorldState(),universe:new UniverseScale(),jobs:new JobQueue(events),providers:new ProviderRegistry(),tools:new ToolRegistry(),sessions:new SessionManager(),persistence:new JsonStore(),commands:new CommandLog(),metrics:new Metrics(),scenes:new Map()};
 studio.universe.seedMilkyWay();
 studio.createScene=input=>{const s=createScene(input);studio.scenes.set(s.id,s);events.emit("scene.created",s);return s;};
 studio.getScene=id=>studio.scenes.get(id)??null;studio.listScenes=()=>[...studio.scenes.values()];
 studio._fullSnapshot=()=>({...studio._baseSnapshot(),privacy:{...studio.privacy},egressAudit:studio.egress.listAudit(),secrets:studio.secrets.exportRedacted(),strategies:studio.strategy.list(),decisions:studio.decisions.list(),research:studio.research.list(),mature:studio.mature.snapshot(),companions:studio.companions.snapshot(),presence:studio.presence.snapshot(),adaptiveIntimacy:studio.adaptiveIntimacy.snapshot()});\n studio.snapshot=()=>{const s=studio._fullSnapshot();delete s.mature;delete s.companions;s.layers=studio.mature.layerStatus();return s;};
 studio._baseSnapshot=()=>({projects:studio.projects.list(),memories:studio.memory.items,agents:studio.agents.list(),assets:[...studio.assets.assets.values()],world:studio.world.snapshot(),universe:studio.universe.list(),scenes:studio.listScenes(),jobs:studio.jobs.list(),graph:studio.graph.snapshot(),characters:studio.characters.list(),sources:studio.sources.list(),documents:studio.knowledgeBase.list(),renders:studio.render.list(),releases:studio.releases.list(),collaboration:studio.collaboration.list()});
 studio.search=(query,limit=30)=>universalSearch(query,[{type:"projects",items:studio.projects.list()},{type:"memories",items:studio.memory.items},{type:"assets",items:[...studio.assets.assets.values()]},{type:"scenes",items:studio.listScenes()},{type:"universe",items:studio.universe.list()}],limit);
 studio.command=async(name,args={})=>studio.commandsRouter.dispatch(name,args);\n studio.save=async()=>studio.persistence.save(studio._fullSnapshot());\n studio.load=async(fallback={})=>{const snapshot=await studio.persistence.load(fallback);return studio.restore(snapshot)};
 studio.commandsRouter.register("adaptive.create",input=>studio.adaptiveIntimacy.create(input)).register("adaptive.update",({id,...input})=>studio.adaptiveIntimacy.update(id,input)).register("adaptive.transition",({id,level,consent=true,reason="user-request"})=>studio.adaptiveIntimacy.transition(id,level,{consent,reason})).register("adaptive.boundary",({id,key,value})=>studio.adaptiveIntimacy.setBoundary(id,key,value)).register("adaptive.preference",({id,key,value})=>studio.adaptiveIntimacy.setPreference(id,key,value)).register("adaptive.signal",({id,signal,value=true})=>studio.adaptiveIntimacy.recordSignal(id,signal,value))
.register("adaptive.mood",({id,mood,reason="user-request"})=>studio.adaptiveIntimacy.setMood(id,mood,reason))
.register("adaptive.energy",({id,energy,reason="adaptive"})=>studio.adaptiveIntimacy.setEnergy(id,energy,reason))
.register("adaptive.cue",({id,cue,enabled=true})=>studio.adaptiveIntimacy.setCue(id,cue,enabled))
.register("adaptive.cues",({id})=>studio.adaptiveIntimacy.getCues(id))
.register("adaptive.adapt",({id,signal=null,positive=true,consent=false})=>studio.adaptiveIntimacy.adapt(id,{signal,positive,consent}))
.register("adaptive.suggest-cue",({id,avoid=[]})=>studio.adaptiveIntimacy.suggestCue(id,{avoid})).register("adaptive.evaluate",({id,requestedLevel=null,consent=false})=>studio.adaptiveIntimacy.evaluate(id,{requestedLevel,consent})).register("adaptive.session.start",({id,media="chat"})=>studio.adaptiveIntimacy.startSession(id,media)).register("adaptive.session.pause",({sessionId})=>studio.adaptiveIntimacy.pauseSession(sessionId)).register("adaptive.session.resume",({sessionId})=>studio.adaptiveIntimacy.resumeSession(sessionId)).register("adaptive.session.end",({sessionId})=>studio.adaptiveIntimacy.endSession(sessionId)).studio.commandsRouter.register("search",({query,limit=30})=>studio.search(query,limit)).register("create.scene",input=>studio.createScene(input)).register("create.character",input=>studio.characters.create(input)).register("create.source",input=>studio.sources.add(input)).register("create.document",input=>studio.knowledgeBase.addDocument(input)).register("queue.render",input=>studio.render.enqueue(input)).register("create.release",input=>studio.releases.create(input)).register("research.create",input=>studio.research.create(input)).register("strategy.create",input=>studio.strategy.create(input)).register("decision.analyze",input=>studio.decisions.analyze(input));
 studio.restore=snapshot=>{if(!snapshot||typeof snapshot!=="object")return studio;for(const p of snapshot.projects??[])studio.projects.upsert(p);for(const m of snapshot.memories??[])studio.memory.items.push(m);for(const c of snapshot.characters??[])studio.characters.characters.set(c.id,c);for(const s of snapshot.sources??[])studio.sources.sources.set(s.id,s);for(const scene of snapshot.scenes??[])studio.scenes.set(scene.id,scene);studio.mature.restore(snapshot.mature??{});studio.companions.restore(snapshot.companions??{});studio.presence.restore(snapshot.presence??{});studio.adaptiveIntimacy.restore(snapshot.adaptiveIntimacy??{});return studio;};
 events.on("asset.created",a=>studio.memory.remember({type:"asset",projectId:a.projectId,content:a.name,importance:.4}));studio.jobs.register("memory.remember",p=>studio.memory.remember(p));return studio;
}