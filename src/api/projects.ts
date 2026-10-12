import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { db } from "../db/index";
import { budgetItems, callSheets, characters, projects, scenes, shootDays } from "../db/schema";

export const PROJECT_STATUSES = ["development", "pre-production", "production", "post"] as const;
type Input = { title: string; primaryScripture?: string; description?: string; status?: string };

const clean = (x: Input) => {
  const title = x.title?.trim();
  if (!title) throw new Error("Project title is required");
  const status = PROJECT_STATUSES.includes(x.status as any) ? x.status : "development";
  return { title, primaryScripture: x.primaryScripture?.trim() || null, description: x.description?.trim() || null, status };
};

const overview = async (id: number) => {
  const project = await db.select().from(projects).where(eq(projects.id, id)).then(r => r[0]);
  if (!project) return null;
  const rows = await db.select({ charactersPresent: scenes.charactersPresent }).from(scenes).where(eq(scenes.projectId, id));
  const ids = [...new Set(rows.flatMap(s => Array.isArray(s.charactersPresent) ? s.charactersPresent : []))];
  const characterCount = ids.length
    ? (await db.select({ id: characters.id }).from(characters).where(inArray(characters.id, ids as number[]))).length
    : 0;
  const today = new Date().toISOString().slice(0, 10);
  const next = await db.select({ date: shootDays.date })
    .from(shootDays)
    .where(and(eq(shootDays.projectId, id), gte(shootDays.date, today)))
    .orderBy(asc(shootDays.date))
    .limit(1)
    .then(r => r[0]);
  return { ...project, sceneCount: rows.length, characterCount, nextShootDay: next?.date ?? null };
};

export const listProjects = async () =>
  Promise.all((await db.select().from(projects).orderBy(asc(projects.title))).map(p => overview(p.id))).then(rows => rows.filter(Boolean));

export const createProject = async (x: Input) => {
  const [row] = await db.insert(projects).values(clean(x)).returning({ id: projects.id });
  return row ? overview(row.id) : null;
};

export const updateProject = async (id: number, x: Input) => {
  await db.update(projects).set({ ...clean(x), updatedAt: new Date() }).where(eq(projects.id, id));
  return overview(id);
};

export const deleteProject = async (id: number) => {
  return db.transaction(async tx => {
    const days = await tx.select({ id: shootDays.id }).from(shootDays).where(eq(shootDays.projectId, id));
    if (days.length) await tx.delete(callSheets).where(inArray(callSheets.shootDayId, days.map(d => d.id)));
    await tx.delete(scenes).where(eq(scenes.projectId, id));
    await tx.delete(budgetItems).where(eq(budgetItems.projectId, id));
    await tx.delete(shootDays).where(eq(shootDays.projectId, id));
    const result = await tx.delete(projects).where(eq(projects.id, id)).returning({ id: projects.id });
    return result.length > 0;
  });
};

export const getProjectOverview = overview;
