import { createCharacter } from "./dna.mjs";

export class CharacterStore {
  constructor(){ this.characters=new Map(); }
  create(input={}){ const c=createCharacter(input); this.characters.set(c.id,c); return c; }
  get(id){ return this.characters.get(id)??null; }
  list(){ return [...this.characters.values()]; }
  update(id,patch={}){ const c=this.get(id); if(!c) throw new Error("Character not found"); Object.assign(c,patch,{updatedAt:new Date().toISOString()}); return c; }
  applyRealism(id,realism){ const c=this.get(id); if(!c) throw new Error("Character not found"); c.visualRealism={...c.visualRealism,...realism}; c.updatedAt=new Date().toISOString(); return c; }
  snapshot(){ return this.list(); }
  restore(items=[]){ for(const c of items) this.characters.set(c.id,c); return this; }
}
