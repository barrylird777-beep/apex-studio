import {asc,eq} from "drizzle-orm";
import {db} from "../db/index";
import {projects,scenes} from "../db/schema";
const clean=(x:any)=>({projectId:Number(x.projectId),sceneNumber:x.sceneNumber==null?null:Number(x.sceneNumber),title:String(x.title||'').trim()||null,scriptureRef:String(x.scriptureRef||x.verses||'').trim(),location:String(x.location||'').trim()||null,charactersPresent:Array.isArray(x.charactersPresent)?x.charactersPresent.map(Number).filter(Number.isInteger):[],actionSummary:String(x.actionSummary||'').trim()||null,emotionalBeat:typeof x.emotionalBeat==='string'?x.emotionalBeat:JSON.stringify(x.emotionalBeat??null),productionNotes:String(x.productionNotes||'').trim()||null,estimatedPages:x.estimatedPages==null?null:Number(x.estimatedPages),dayOrNight:String(x.dayOrNight||'').trim()||null});
export async function listScenes(projectId:number){return db.select().from(scenes).where(eq(scenes.projectId,projectId)).orderBy(asc(scenes.sceneNumber),asc(scenes.id)).execute();}
export async function createScene(x:any){
  const project=(await db.select({id:projects.id}).from(projects).where(eq(projects.id,Number(x.projectId))).limit(1).execute())[0];
  if(!project)return null;
  const [created]=await db.insert(scenes).values(clean(x)).returning({id:scenes.id});
  if(!created)return null;
  const row=(await db.select().from(scenes).where(eq(scenes.id,created.id)).limit(1).execute())[0];
  return row??null;
}
export async function updateScene(id:number,x:any){
  const old=(await db.select().from(scenes).where(eq(scenes.id,id)).limit(1).execute())[0];
  if(!old)return null;
  await db.update(scenes).set(clean({...old,...x})).where(eq(scenes.id,id)).execute();
  return (await db.select().from(scenes).where(eq(scenes.id,id)).limit(1).execute())[0]??null;
}
export async function deleteScene(id:number){
  return (await db.delete(scenes).where(eq(scenes.id,id)).execute()).rowCount ?? 0) > 0;
}
