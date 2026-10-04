import {and,asc,eq,gte,inArray} from "drizzle-orm";
import {db} from "../db/index";
import {budgetItems,callSheets,characters,projects,scenes,shootDays} from "../db/schema";
export const PROJECT_STATUSES=["development","pre-production","production","post"] as const;
type Input={title:string;primaryScripture?:string;description?:string;status?:string};
const clean=(x:Input)=>{const title=x.title?.trim();if(!title)throw new Error("Project title is required");const status=PROJECT_STATUSES.includes(x.status as any)?x.status:"development";return{title,primaryScripture:x.primaryScripture?.trim()||null,description:x.description?.trim()||null,status};};

export async function getProjectOverview(id:number){
  const project=(await db.select().from(projects).where(eq(projects.id,id)).limit(1).execute())[0];
  if(!project)return null;
  const rows=await db.select({charactersPresent:scenes.charactersPresent}).from(scenes).where(eq(scenes.projectId,id)).execute();
  const ids=[...new Set(rows.flatMap(s=>Array.isArray(s.charactersPresent)?s.charactersPresent:[]))];
  const characterCount=ids.length?(await db.select({id:characters.id}).from(characters).where(inArray(characters.id,ids)).execute()).length:0;
  const today=new Date().toISOString().slice(0,10);
  const next=(await db.select({date:shootDays.date}).from(shootDays).where(and(eq(shootDays.projectId,id),gte(shootDays.date,today))).orderBy(asc(shootDays.date)).limit(1).execute())[0];
  return {...project,sceneCount:rows.length,characterCount,nextShootDay:next?.date??null};
}
export async function listProjects(){
  const rows=await db.select().from(projects).orderBy(asc(projects.title)).execute();
  return Promise.all(rows.map(p=>getProjectOverview(p.id)));
}
export async function createProject(x:Input){
  const [created]=await db.insert(projects).values(clean(x)).returning({id:projects.id});
  return created?getProjectOverview(created.id):null;
}
export async function updateProject(id:number,x:Input){
  await db.update(projects).set({...clean(x),updatedAt:new Date()}).where(eq(projects.id,id)).execute();
  return getProjectOverview(id);
}
export async function deleteProject(id:number){
  await db.transaction(async tx=>{
    const days=await tx.select({id:shootDays.id}).from(shootDays).where(eq(shootDays.projectId,id)).execute();
    if(days.length)await tx.delete(callSheets).where(inArray(callSheets.shootDayId,days.map(d=>d.id))).execute();
    await tx.delete(scenes).where(eq(scenes.projectId,id)).execute();
    await tx.delete(budgetItems).where(eq(budgetItems.projectId,id)).execute();
    await tx.delete(shootDays).where(eq(shootDays.projectId,id)).execute();
    await tx.delete(projects).where(eq(projects.id,id)).execute();
  });
}
