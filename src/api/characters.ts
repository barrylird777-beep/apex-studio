import { asc, eq, like, or } from "drizzle-orm";
import { db } from "../db/index";
import { characters } from "../db/schema";

export type CharacterInput = {
  canonicalName:string; aliases?:string[]; primaryStories?:string[];
  relationships?:{name:string;relation:string}[]; keyTraits?:string[]; notes?:string; scriptureReferences?:string[];
};
const cleanList=(v?:string[])=>Array.isArray(v)?v.map(x=>x.trim()).filter(Boolean):[];
const clean=(x:CharacterInput)=>{const canonicalName=x.canonicalName?.trim();if(!canonicalName)throw new Error("Canonical name is required");return {canonicalName,aliases:cleanList(x.aliases),primaryStories:cleanList(x.primaryStories),relationships:Array.isArray(x.relationships)?x.relationships.filter(r=>r?.name?.trim()&&r?.relation?.trim()).map(r=>({name:r.name.trim(),relation:r.relation.trim()})):[],keyTraits:cleanList(x.keyTraits),notes:x.notes?.trim()||null,scriptureReferences:cleanList(x.scriptureReferences)};};

export async function listCharacters(query=""){
  const q=query.trim();
  return db.select().from(characters).where(q?or(like(characters.canonicalName,`%${q}%`),like(characters.primaryStories,`%${q}%`),like(characters.aliases,`%${q}%`)):undefined).orderBy(asc(characters.canonicalName)).execute();
}
export async function getCharacter(id:number){
  return (await db.select().from(characters).where(eq(characters.id,id)).limit(1).execute())[0]??null;
}
export async function createCharacter(x:CharacterInput){
  const [created]=await db.insert(characters).values(clean(x)).returning({id:characters.id});
  return created?getCharacter(created.id):null;
}
export async function updateCharacter(id:number,x:CharacterInput){
  if(!(await getCharacter(id)))return null;
  await db.update(characters).set(clean(x)).where(eq(characters.id,id)).execute();
  return getCharacter(id);
}
export async function deleteCharacter(id:number){
  const result=await db.delete(characters).where(eq(characters.id,id)).execute();
  return result.rowCount>0;
}
