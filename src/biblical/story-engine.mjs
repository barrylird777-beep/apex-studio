import { uid, now } from "../core/id.mjs";

export const DRAMATIZATION = Object.freeze(["direct","paraphrase","inference","dramatization","fictional"]);

function required(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(name + " is required");
  return value.trim();
}

export class BiblicalStoryEngine {
  constructor({sourceRegistry=null}={}) {
    this.sourceRegistry=sourceRegistry;
    this.stories=new Map();
    this.events=new Map();
  }

  createStory(input={}) {
    const story={id:input.id??uid("story"),title:required(input.title,"title"),description:input.description??"",
      tradition:input.tradition??null,canonPolicy:input.canonPolicy??"source-explicit",
      sourceIds:[...(input.sourceIds??[])],events:[],createdAt:now(),updatedAt:now()};
    if(this.sourceRegistry) for(const id of story.sourceIds) if(!this.sourceRegistry.get(id)) throw new Error("Unknown source: "+id);
    this.stories.set(story.id,story); return story;
  }

  addEvent(storyId,input={}) {
    const story=this.stories.get(storyId); if(!story) throw new Error("Story not found");
    const dramatization=input.dramatization??"direct";
    if(!DRAMATIZATION.includes(dramatization)) throw new Error("Unknown dramatization type: "+dramatization);
    const sourceRefs=(input.sourceRefs??[]).map(ref=>({...ref,id:ref.id??uid("ref"),sourceId:required(ref.sourceId,"sourceId"),locator:required(ref.locator,"locator")}));
    if(this.sourceRegistry) for(const ref of sourceRefs) if(!this.sourceRegistry.get(ref.sourceId)) throw new Error("Unknown source: "+ref.sourceId);
    const event={id:input.id??uid("event"),storyId,title:required(input.title,"event title"),description:input.description??"",
      order:Number.isFinite(input.order)?input.order:story.events.length,chronology:input.chronology??null,
      characters:[...(input.characters??[])],locations:[...(input.locations??[])],themes:[...(input.themes??[])],
      dramatization,sourceRefs,notes:input.notes??"",createdAt:now(),updatedAt:now()};
    this.events.set(event.id,event); story.events.push(event.id); story.events.sort((a,b)=>(this.events.get(a)?.order??0)-(this.events.get(b)?.order??0)); story.updatedAt=now(); return event;
  }

  getStory(id){return this.stories.get(id)??null}
  getEvent(id){return this.events.get(id)??null}
  listStories(){return [...this.stories.values()]}
  listEvents(storyId){return (this.stories.get(storyId)?.events??[]).map(id=>this.events.get(id)).filter(Boolean)}

  toScene(eventId, options={}) {
    const e=this.getEvent(eventId); if(!e) throw new Error("Story event not found");
    return {id:uid("scene"),title:e.title,projectId:options.projectId??null,timelineId:options.timelineId??null,
      characters:[...e.characters],beats:[{id:uid("beat"),title:e.title,description:e.description,order:e.order,dramatization:e.dramatization}],
      dialogue:[],shots:[],continuityRefs:[...e.characters,...e.locations],sourceMode:e.dramatization,
      provenance:{storyId:e.storyId,eventId:e.id,sourceRefs:e.sourceRefs.map(r=>({...r}))},status:"draft",createdAt:now(),updatedAt:now()};
  }

  provenance(eventId){const e=this.getEvent(eventId);return e?e.sourceRefs.map(r=>({...r,source:this.sourceRegistry?.get(r.sourceId)??null})):[]}
  validateStory(storyId){
    const story=this.getStory(storyId); if(!story) throw new Error("Story not found");
    const events=this.listEvents(storyId);
    const errors=[];
    for(const e of events){
      if(!e.sourceRefs.length && e.dramatization==="direct") errors.push({eventId:e.id,code:"DIRECT_EVENT_NEEDS_SOURCE",message:"Direct events require at least one source reference"});
      for(const ref of e.sourceRefs) if(!this.sourceRegistry?.get(ref.sourceId)) errors.push({eventId:e.id,code:"UNKNOWN_SOURCE",sourceId:ref.sourceId});
    }
    return {valid:errors.length===0,errors,storyId,eventCount:events.length};
  }
  buildProductionPlan(storyId){
    const check=this.validateStory(storyId); if(!check.valid) throw new Error("Story validation failed: "+check.errors.map(e=>e.code).join(","));
    return this.listEvents(storyId).map((event,index)=>({
      order:index,storyId,eventId:event.id,title:event.title,sourceMode:event.dramatization,
      scene:this.toScene(event),production:{screenplay:true,storyboard:true,shots:true,dialogue:true,narration:true,audio:true,render:true}
    }));
  }
  snapshot(){return {stories:this.listStories(),events:[...this.events.values()]}}
  restore(s={}){this.stories.clear();this.events.clear();for(const x of s.stories??[])this.stories.set(x.id,{...x,events:[...(x.events??[])]});for(const x of s.events??[])this.events.set(x.id,{...x,sourceRefs:[...(x.sourceRefs??[])]});return this}
}