import { apexPureDataStore as store } from "../core/apex-pure-data.mjs";

export type CharacterInput = {
  canonicalName: string;
  aliases?: string[];
  primaryStories?: string[];
  relationships?: { name: string; relation: string }[];
  keyTraits?: string[];
  notes?: string;
  scriptureReferences?: string[];
};

const clean=(x:CharacterInput)=>({
  canonicalName:x.canonicalName?.trim() || "",
  aliases:Array.isArray(x.aliases)?x.aliases.map(String).filter(Boolean):[],
  primaryStories:Array.isArray(x.primaryStories)?x.primaryStories.map(String).filter(Boolean):[],
  relationships:Array.isArray(x.relationships)?x.relationships.filter(r=>r?.name?.trim()&&r?.relation?.trim()).map(r=>({name:r.name.trim(),relation:r.relation.trim()})):[],
  keyTraits:Array.isArray(x.keyTraits)?x.keyTraits.map(String).filter(Boolean):[],
  notes:x.notes?.trim()||null,
  scriptureReferences:Array.isArray(x.scriptureReferences)?x.scriptureReferences.map(String).filter(Boolean):[]
});

export const listCharacters=async(query="")=>{
  const q=query.trim().toLowerCase();
  return (await store.list("characters"))
    .filter(x=>!q||[x.canonicalName,...(x.aliases||[]),...(x.primaryStories||[])].some(v=>String(v).toLowerCase().includes(q)))
    .sort((a,b)=>String(a.canonicalName).localeCompare(String(b.canonicalName)));
};

export const getCharacter=async(id:number|string)=>store.get("characters",String(id));

export const createCharacter=async(x:CharacterInput)=>{
  const row=clean(x);
  if(!row.canonicalName)throw new Error("Canonical name is required");
  const duplicate=(await store.list("characters")).find(c=>String(c.canonicalName).toLowerCase()===row.canonicalName.toLowerCase());
  if(duplicate)throw Object.assign(new Error("Character already exists"),{code:"DUPLICATE"});
  return store.create("characters",row);
};

export const updateCharacter=async(id:number|string,x:CharacterInput)=>{
  if(!(await getCharacter(id)))return null;
  const row=clean(x);
  if(!row.canonicalName)throw new Error("Canonical name is required");
  return store.put("characters",String(id),row);
};

export const deleteCharacter=async(id:number|string)=>{
  if(!(await getCharacter(id)))return false;
  await store.delete("characters",String(id));
  return true;
};
