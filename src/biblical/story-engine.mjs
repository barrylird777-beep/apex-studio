import { uid, now } from "../core/id.mjs";

export const DRAMATIZATION=Object.freeze(["direct","paraphrase","inference","dramatization","fictional"]);

function required(value,name){if(typeof value!=="string"||!value.trim())throw new TypeError(name+" is required");return value.trim();}

export class BiblicalStoryEngine{
 constructor({sourceRegistry=null}={}){this.sourceRegistry=sourceRegistry;this.stories=new Map();this.events=new Map();}

 createStory(input={}){
  const story={id:input.id??uid("story"),title:required(input.title,"title"),description:input.description??"",tradition:input.tradition??null,canonPolicy:input.canonPolicy??"source-explicit",sourceIds:[...(input.sourceIds??[])],events:[],createdAt:now(),updatedAt:now()};
  if(this.sourceRegistry)for(const id of story.sourceIds)if(!this.sourceRegistry.get(id))throw new Error("Unknown source: "+id);
  this.stories.set(story.id,story);return story;
 }

 addEvent(storyId,input={}){
  const story=this.stories.get(storyId);if(!story)throw new Error("Story not found");
  const dramatization=input.dramatization??"direct";
  if(!DRAMATIZATION.includes(dramatization))throw new Error("Unknown dramatization type: "+dramatization);
  const sourceRefs=(input.sourceRefs??[]).map(ref=>({...ref,id:ref.id??uid("ref"),sourceId:required(ref.sourceId,"sourceId"),locator:required(ref.locator,"locator")}));
  if(this.sourceRegistry)for(const ref of sourceRefs)if(!this.sourceRegistry.get(ref.sourceId))throw new Error("Unknown source: "+ref.sourceId);
  const event={id:input.id??uid("event"),storyId,title:required(input.title,"event title"),description:input.description??"",order:Number.isFinite(input.order)?input.order:story.events.length,chronology:input.chronology??null,characters:[...(input.characters??[])],locations:[...(input.locations??[])],themes:[...(input.themes??[])],dramatization,sourceRefs,notes:input.notes??"",createdAt:now(),updatedAt:now()};
  this.events.set(event.id,event);story.events.push(event.id);story.events.sort((a,b)=>(this.events.get(a)?.order??0)-(this.events.get(b)?.order??0));story.updatedAt=now();return event;
 }

 getStory(id){return this.stories.get(id)??null}
 getEvent(id){return this.events.get(id)??null}
 listStories(){return [...this.stories.values()]}
 listEvents(storyId){return (this.stories.get(storyId)?.events??[]).map(id=>this.events.get(id)).filter(Boolean)}

 toScene(eventId,options={}){
  const e=this.getEvent(eventId);if(!e)throw new Error("Story event not found");
  return {id:uid("scene"),title:e.title,projectId:options.projectId??null,storyId:e.storyId,storyEventId:e.id,timelineId:options.timelineId??null,characters:[...e.characters],beats:[{id:uid("beat"),title:e.title,description:e.description,order:e.order,dramatization:e.dramatization}],dialogue:[],shots:[],continuityRefs:[...e.characters,...e.locations],sourceRefs:e.sourceRefs.map(r=>({...r})),sourceMode:e.dramatization,provenance:{storyId:e.storyId,eventId:e.id,sourceRefs:e.sourceRefs.map(r=>({...r}))},status:"draft",createdAt:now(),updatedAt:now()};
 }

 provenance(eventId){const e=this.getEvent(eventId);return e?e.sourceRefs.map(r=>({...r,source:this.sourceRegistry?.get(r.sourceId)??null})):[]}
 snapshot(){return {stories:this.listStories(),events:[...this.events.values()]}}
 restore(s={}){this.stories.clear();this.events.clear();for(const x of s.stories??[])this.stories.set(x.id,{...x,events:[...(x.events??[])]});for(const x of s.events??[])this.events.set(x.id,{...x,sourceRefs:[...(x.sourceRefs??[])]});return this}
}