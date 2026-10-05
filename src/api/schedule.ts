import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index";
import { projects, scenes, shootDayScenes, shootDays } from "../db/schema";
import { autoSchedule, buildCalendar } from "../schedule/rules.js";

type ShootDayRow = typeof shootDays.$inferSelect;
type SceneRow = typeof scenes.$inferSelect;
export type ScheduleOptions = { maxScenes?: number };
export type ShootDayInput = { projectId: number; shootDate: string; callTime?: string | null; notes?: string };

const mapDay = (r: ShootDayRow) => ({
  id: r.id,
  projectId: r.projectId,
  shootDate: r.date,
  callTime: r.callTime ?? null,
  notes: r.notes ?? "",
});

const mapScene = (r: SceneRow) => ({
  ...r,
  sequence: r.sceneNumber ?? r.id,
  location: { name: r.location ?? "", timeOfDay: r.dayOrNight || "UNSPECIFIED" },
});

export async function createShootDay({ projectId, shootDate, callTime = null, notes = "" }: ShootDayInput) {
  const project = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).then(r => r[0]);
  if (!project) return null;
  const existing = await db.select().from(shootDays).where(and(eq(shootDays.projectId, projectId), eq(shootDays.date, shootDate))).then(r => r[0]);
  if (existing) throw Object.assign(new Error("A shoot day already exists for this project and date"), { code: "DUPLICATE_DATE" });
  const [row] = await db.insert(shootDays).values({ projectId, date: shootDate, notes, callTime, unit: "1st Unit" }).returning();
  return row ? mapDay(row) : null;
}

export async function deleteShootDay(id: number) {
  return (await db.delete(shootDays).where(eq(shootDays.id, id)).returning({ id: shootDays.id })).length > 0;
}

export async function getDay(id: number) {
  const row = await db.select().from(shootDays).where(eq(shootDays.id, id)).then(r => r[0]);
  return row ? mapDay(row) : null;
}

export async function listDays(projectId: number) {
  return (await db.select().from(shootDays).where(eq(shootDays.projectId, projectId)).orderBy(asc(shootDays.date), asc(shootDays.id))).map(mapDay);
}

export async function listAssignments(projectId: number) {
  return db.select({
    sceneId: shootDayScenes.sceneId,
    shootDayId: shootDayScenes.shootDayId,
    position: shootDayScenes.position,
  })
    .from(shootDayScenes)
    .innerJoin(shootDays, eq(shootDayScenes.shootDayId, shootDays.id))
    .where(eq(shootDays.projectId, projectId))
    .orderBy(asc(shootDayScenes.position), asc(shootDayScenes.sceneId));
}

export async function listScenesForProject(projectId: number) {
  return (await db.select().from(scenes).where(eq(scenes.projectId, projectId)).orderBy(asc(scenes.sceneNumber), asc(scenes.id))).map(mapScene);
}

export async function assignScenes(shootDayId: number, sceneIds: unknown[]) {
  const day = await getDay(shootDayId);
  if (!day) throw Object.assign(new Error("Shoot day not found"), { code: "NOT_FOUND" });
  const uniqueIds = [...new Set(sceneIds.map(Number))];
  const valid = uniqueIds.length
    ? (await db.select({ id: scenes.id }).from(scenes).where(and(eq(scenes.projectId, day.projectId), inArray(scenes.id, uniqueIds)))).map(x => x.id)
    : [];
  if (uniqueIds.some(id => !valid.includes(id))) {
    throw Object.assign(new Error("All scenes must belong to the same project as the shoot day"), { code: "PROJECT_SCOPE" });
  }

  const existing = await db.select().from(shootDayScenes)
    .where(eq(shootDayScenes.shootDayId, shootDayId)).orderBy(asc(shootDayScenes.position));
  const current = existing.map(x => x.sceneId).filter(id => !uniqueIds.includes(id));

  await db.transaction(async tx => {
    if (uniqueIds.length) await tx.delete(shootDayScenes).where(inArray(shootDayScenes.sceneId, uniqueIds));
    if (current.length) await tx.delete(shootDayScenes).where(eq(shootDayScenes.shootDayId, shootDayId));
    const rows = [...current, ...uniqueIds].map((sceneId, position) => ({ sceneId, shootDayId, position }));
    if (rows.length) await tx.insert(shootDayScenes).values(rows);
  });
  return listAssignments(day.projectId);
}

export async function unassignScene(sceneId: number) {
  return (await db.delete(shootDayScenes).where(eq(shootDayScenes.sceneId, sceneId)).returning({ sceneId: shootDayScenes.sceneId })).length > 0;
}

export async function reorderDay(shootDayId: number, sceneIds: unknown[]) {
  const day = await getDay(shootDayId);
  if (!day) throw Object.assign(new Error("Shoot day not found"), { code: "NOT_FOUND" });
  const uniqueIds = [...new Set(sceneIds.map(Number))];
  const assigned = (await db.select({ sceneId: shootDayScenes.sceneId }).from(shootDayScenes).where(eq(shootDayScenes.shootDayId, shootDayId))).map(x => x.sceneId);
  if (assigned.length !== uniqueIds.length || assigned.some(id => !uniqueIds.includes(id))) {
    throw Object.assign(new Error("Order must contain exactly the scenes assigned to this day"), { code: "INVALID_ORDER" });
  }
  await db.transaction(async tx => {
    for (const [position, sceneId] of uniqueIds.entries()) {
      await tx.update(shootDayScenes).set({ position }).where(and(eq(shootDayScenes.shootDayId, shootDayId), eq(shootDayScenes.sceneId, sceneId)));
    }
  });
  return listAssignments(day.projectId);
}

export async function getCalendar(projectId: number, options?: ScheduleOptions) {
  const scenesForProject = await listScenesForProject(projectId);
  const days = await listDays(projectId);
  return buildCalendar({ days, assignments: await listAssignments(projectId), scenes: scenesForProject, options });
}

export async function runAutoSchedule(projectId: number, options?: ScheduleOptions) {
  const all = await listScenesForProject(projectId);
  const assignments = await listAssignments(projectId);
  const assigned = new Set(assignments.map(a => a.sceneId));
  const unassigned = all.filter(s => !assigned.has(s.id));
  const days = await listDays(projectId);
  const result = autoSchedule(unassigned, days.map(d => ({
    ...d,
    existingCount: assignments.filter(a => a.shootDayId === d.id).length,
  })), options);
  for (const item of result.plan) await assignScenes(item.dayId, item.sceneIds);
  return { ...(await getCalendar(projectId, options)), overflow: result.overflow };
}
