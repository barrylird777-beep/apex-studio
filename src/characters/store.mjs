import { createCharacter } from "./dna.mjs";

const normalize=(value)=>String(value??"").trim().toLocaleLowerCase();

export class CharacterStore {
  constructor(){ this.characters=new Map(); }
  create(input={}){ const c=createCharacter(input); this.characters.set(c.id,c); return c; }
  get(id){ return this.characters.get(id)??null; }
  list(){ return [...this.characters.values()].sort((a,b)=>a.canonicalName.localeCompare(b.canonicalName)); }
  search(query=""){ const q=normalize(query); if(!q) return this.list(); return this.list().filter(c=>[
    c.canonicalName,...c.aliases,...c.primaryStories,...c.relationships,...c.keyTraits,...c.scriptureReferences,c.notes
  ].some(v=>normalize(v).includes(q))); }
  update(id,patch={}) {
    const c=this.get(id); if(!c) throw new Error("Character not found");
    const next={...patch};
    if("canonicalName" in next || "name" in next){ const name=String(next.canonicalName??next.name??"").trim(); if(!name) throw new TypeError("canonicalName is required"); next.canonicalName=name; next.name=name; }
    for(const key of ["aliases","primaryStories","relationships","keyTraits","scriptureReferences","linkedSceneIds"]) if(key in next) next[key]=Array.isArray(next[key])?next[key].map(v=>String(v).trim()).filter(Boolean):[];
    if("notes" in next) next.notes=String(next.notes??"").trim();
    Object.assign(c,next,{updatedAt:new Date().toISOString()}); return c;
  }
  delete(id){ if(!this.characters.has(id)) return false; return this.characters.delete(id); }
  linkScene(id,sceneId){ const c=this.get(id); if(!c) throw new Error("Character not found"); const value=String(sceneId??"").trim(); if(!value) throw new TypeError("sceneId is required"); if(!c.linkedSceneIds.includes(value)) c.linkedSceneIds.push(value); c.updatedAt=new Date().toISOString(); return c; }
  snapshot(){ return this.list(); }
  restore(items=[]){ this.characters.clear(); for(const c of items) this.characters.set(c.id,c); return this; }
  applyRealism(id,realism){ const c=this.get(id); if(!c) throw new Error("Character not found"); c.visualRealism={...c.visualRealism,...realism}; c.updatedAt=new Date().toISOString(); return c; }
}
