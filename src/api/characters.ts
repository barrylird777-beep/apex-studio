import { asc, eq, like, or } from "drizzle-orm";
import { db } from "../db/index";
import { characters } from "../db/schema";

export type CharacterInput = {
 canonicalName:string; aliases?:string[]; primaryStories?:string[];
 relationships?:{name:string;relation:string}[]; keyTraits?:string[]; notes?:string; scriptureReferences?:string[];
};
const cleanList=(v?:string[])=>Array.isArray(v)?v.map(x=>x.trim()).filter(Boolean):[];
const clean=(x:CharacterInput)=>{const canonicalName=x.canonicalName?.trim();if(!canonicalName)throw new Error("Canonical name is required");return {canonicalName,aliases:cleanList(x.aliases),primaryStories:cleanList(x.primaryStories),relationships:Array.isArray(x.relationships)?x.relationships.filter(r=>r?.name?.trim()&&r?.relation?.trim()).map(r=>({name:r.name.trim(),relation:r.relation.trim()})):[],keyTraits:cleanList(x.keyTraits),notes:x.notes?.trim()||null,scriptureReferences:cleanList(x.scriptureReferences)};};
export const listCharacters=(query="")=>{const q=query.trim();return db.select().from(characters).where(q?or(like(characters.canonicalName,`%${q}%`),like(characters.primaryStories,`%${q}%`),like(characters.aliases,`%${q}%`)):undefined).orderBy(asc(characters.canonicalName)).all();};
export const getCharacter=(id:number)=>db.select().from(characters).where(eq(characters.id,id)).get()??null;
export const createCharacter=(x:CharacterInput)=>{const r=db.insert(characters).values(clean(x)).run();return getCharacter(Number(r.lastInsertRowid));};
export const updateCharacter=(id:number,x:CharacterInput)=>{if(!getCharacter(id))return null;db.update(characters).set(clean(x)).where(eq(characters.id,id)).run();return getCharacter(id);};
export const deleteCharacter=(id:number)=>{const r=db.delete(characters).where(eq(characters.id,id)).run();return r.changes>0;};