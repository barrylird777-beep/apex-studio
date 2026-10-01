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
export function createStudio(){
 const studio={version:"4.0.0",events:new EventBus(),projects:new ProjectStore(),memory:new MemoryStore(),graph:new KnowledgeGraph(),continuity:new ContinuityLedger(),timelines:new TimelineEngine(),production:new ProductionGraph(),agents:new AgentRegistry(),orchestrator:new AgentOrchestrator(),assets:new AssetRegistry(),world:new WorldState()};
 studio.events.on("asset.created",a=>studio.memory.remember({type:"asset",projectId:a.projectId,content:a.name,importance:.4}));
 return studio;
}
