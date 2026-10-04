import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/index";
import { projects, scenes, shootDayScenes, shootDays } from "../db/schema";
import { autoSchedule, buildCalendar } from "../schedule/rules.js";

type ShootDayRow = typeof shootDays.$inferSelect;
type SceneRow = typeof scenes.$inferSelect;

const mapDay = (r: ShootDayRow) => ({ id: r.id, projectId: r.projectId, shootDate: r.date, callTime: r.callTime ?? null, notes: r.notes ?? "" });
const mapScene = (r: SceneRow) => ({ ...r, sequence: r.sceneNumber ?? r.id, location: { name: r.location ?? "", timeOfDay: r.dayOrNight || "UNSPECIFIED" } });

export function createShootDay({projectId, shootDate, callTime = null, notes = ""}) {
  const project = db.select({id: projects.id}).from(projects).where(eq(projects.id, projectId)).get();
  if (!project) return null;
  const existing = db.select().from(shootDays).where(and(eq(shootDays.projectId,projectId),eq(shootDays.date,shootDate))).get();
  if (existing) throw Object.assign(new Error("A shoot day already exists for this project and date"), { code: "DUPLICATE_DATE" });
  const result = db.insert(shootDays).values({projectId,date:shootDate,notes,callTime,unit:"1st Unit"}).run();
  return mapDay(db.select().from(shootDays).where(eq(shootDays.id,Number(result.lastInsertRowid))).get());
}

export function deleteShootDay(id) {
  return db.delete(shootDays).where(eq(shootDays.id,id)).run().changes > 0;
}

export function getDay(id) {
  const row = db.select().from(shootDays).where(eq(shootDays.id,id)).get();
  return row ? mapDay(row) : null;
}

export function listDays(projectId) {
  return db.select().from(shootDays).where(eq(shootDays.projectId,projectId)).orderBy(asc(shootDays.date),asc(shootDays.id)).all().map(mapDay);
}

export function listAssignments(projectId) {
  return db.select({sceneId:shootDayScenes.sceneId,shootDayId:shootDayScenes.shootDayId,position:shootDayScenes.position})
    .from(shootDayScenes).innerJoin(shootDays,eq(shootDayScenes.shootDayId,shootDays.id))
    .where(eq(shootDays.projectId,projectId)).orderBy(asc(shootDayScenes.position),asc(shootDayScenes.sceneId)).all();
}

export function listScenesForProject(projectId) {
  return db.select().from(scenes).where(eq(scenes.projectId,projectId)).orderBy(asc(scenes.sceneNumber),asc(scenes.id)).all().map(mapScene);
}

export function assignScenes(shootDayId, sceneIds) {
  const day = getDay(shootDayId);
  if (!day) throw Object.assign(new Error("Shoot day not found"), { code: "NOT_FOUND" });
  const uniqueIds = [...new Set(sceneIds.map(Number))];
  const valid = uniqueIds.length ? db.select({id:scenes.id}).from(scenes).where(eq(scenes.projectId,day.projectId)).all().map(x=>x.id) : [];
  if (uniqueIds.some(id => !valid.includes(id))) throw Object.assign(new Error("All scenes must belong to the same project as the shoot day"), { code: "PROJECT_SCOPE" });
  const existing = db.select().from(shootDayScenes).where(eq(shootDayScenes.shootDayId,shootDayId)).orderBy(asc(shootDayScenes.position)).all();
  const current = existing.map(x=>x.sceneId).filter(id=>!uniqueIds.includes(id));
  db.transaction(tx => {
    for (const id of uniqueIds) tx.delete(shootDayScenes).where(eq(shootDayScenes.sceneId,id)).run();
    for (const [position,sceneId] of [...current,...uniqueIds].entries()) tx.insert(shootDayScenes).values({sceneId,shootDayId,position}).run();
  });
  return listAssignments(day.projectId);
}

export function unassignScene(sceneId) {
  return db.delete(shootDayScenes).where(eq(shootDayScenes.sceneId,sceneId)).run().changes > 0;
}

export function reorderDay(shootDayId, sceneIds) {
  const day = getDay(shootDayId);
  if (!day) throw Object.assign(new Error("Shoot day not found"), { code: "NOT_FOUND" });
  const uniqueIds = [...new Set(sceneIds.map(Number))];
  const assigned = db.select({sceneId:shootDayScenes.sceneId}).from(shootDayScenes).where(eq(shootDayScenes.shootDayId,shootDayId)).all().map(x=>x.sceneId);
  if (assigned.length !== uniqueIds.length || assigned.some(id=>!uniqueIds.includes(id))) throw Object.assign(new Error("Order must contain exactly the scenes assigned to this day"), { code: "INVALID_ORDER" });
  db.transaction(tx => uniqueIds.forEach((sceneId,position)=>tx.update(shootDayScenes).set({position}).where(and(eq(shootDayScenes.shootDayId,shootDayId),eq(shootDayScenes.sceneId,sceneId))).run()));
  return listAssignments(day.projectId);
}

export function getCalendar(projectId, options) {
  const scenesForProject = listScenesForProject(projectId);
  const days = listDays(projectId);
  return buildCalendar({days,assignments:listAssignments(projectId),scenes:scenesForProject,options});
}

export function runAutoSchedule(projectId, options) {
  const all = listScenesForProject(projectId);
  const assignments = listAssignments(projectId);
  const assigned = new Set(assignments.map(a=>a.sceneId));
  const unassigned = all.filter(s=>!assigned.has(s.id));
  const days = listDays(projectId).map(d=>({...d,existingCount:assignments.filter(a=>a.shootDayId===d.id).length}));
  const result = autoSchedule(unassigned,days,options);
  for (const item of result.plan) assignScenes(item.dayId,item.sceneIds);
  return { ...getCalendar(projectId,options), overflow: result.overflow };
}
