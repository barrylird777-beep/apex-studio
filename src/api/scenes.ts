import { asc, eq } from "drizzle-orm";
import { db } from "../db/index";
import { projects, scenes } from "../db/schema";

const clean = (x: any) => ({
  projectId: Number(x.projectId),
  sceneNumber: x.sceneNumber == null ? null : Number(x.sceneNumber),
  title: String(x.title || "").trim() || null,
  scriptureRef: String(x.scriptureRef || x.verses || "").trim(),
  location: String(x.location || "").trim() || null,
  charactersPresent: Array.isArray(x.charactersPresent) ? x.charactersPresent.map(Number).filter(Number.isInteger) : [],
  actionSummary: String(x.actionSummary || "").trim() || null,
  emotionalBeat: typeof x.emotionalBeat === "string" ? x.emotionalBeat : JSON.stringify(x.emotionalBeat ?? null),
  productionNotes: String(x.productionNotes || "").trim() || null,
  estimatedPages: x.estimatedPages == null ? null : Number(x.estimatedPages),
  dayOrNight: String(x.dayOrNight || "").trim() || null,
});

export const listScenes = async (projectId: number) =>
  db.select().from(scenes).where(eq(scenes.projectId, projectId)).orderBy(asc(scenes.sceneNumber), asc(scenes.id));

export const createScene = async (x: any) => {
  const project = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, Number(x.projectId))).then(r => r[0]);
  if (!project) return null;
  const [row] = await db.insert(scenes).values(clean(x)).returning();
  return row ?? null;
};

export const updateScene = async (id: number, x: any) => {
  const old = await db.select().from(scenes).where(eq(scenes.id, id)).then(r => r[0]);
  if (!old) return null;
  const [row] = await db.update(scenes).set(clean({ ...old, ...x })).where(eq(scenes.id, id)).returning();
  return row ?? null;
};

export const deleteScene = async (id: number) =>
  (await db.delete(scenes).where(eq(scenes.id, id)).returning({ id: scenes.id })).length > 0;
