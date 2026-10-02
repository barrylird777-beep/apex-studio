import { uid, now } from "./id.mjs";
export class ReleaseManager {
 constructor(){this.releases=new Map();}
 create(input={}){const r={id:input.id??uid("release"),name:input.name??"Untitled Release",projectId:input.projectId??null,artifactIds:input.artifactIds??[],status:"draft",createdAt:input.createdAt??now()};this.releases.set(r.id,r);return r;}
 publish(id){const r=this.releases.get(id);if(!r)throw new Error("Release not found");r.status="published";r.publishedAt=now();return r;}
 list(){return [...this.releases.values()];}
 restore(items=[]){this.releases.clear();for(const r of items)this.releases.set(r.id,{...r});return this;}
}