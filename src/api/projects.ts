import { apexPureDataStore as store } from "../core/apex-pure-data.mjs";

export const PROJECT_STATUSES = ["development","pre-production","production","post"] as const;
type Input = { title: string; primaryScripture?: string; description?: string; status?: string };

const clean = (x: Input) => {
  const title = x.title?.trim();
  if (!title) throw new Error("Project title is required");
  return {
    title,
    primaryScripture: x.primaryScripture?.trim() || null,
    description: x.description?.trim() || null,
    status: PROJECT_STATUSES.includes(x.status as any) ? x.status : "development"
  };
};

const overview = async (id: string | number) => {
  const project = await store.get("projects", String(id));
  if (!project) return null;
  const scenes = await store.query("scenes", x => Number(x.projectId) === Number(id));
  const days = await store.query("shootDays", x => Number(x.projectId) === Number(id), {
    sort: (a,b) => String(a.date).localeCompare(String(b.date))
  });
  const chars = await store.list("characters");
  const ids = new Set(
    scenes.flatMap(s => Array.isArray(s.charactersPresent) ? s.charactersPresent : []).map(Number)
  );
  const characterCount = chars.filter(c => ids.has(Number(c.id))).length;
  const today = new Date().toISOString().slice(0,10);
  const next = days.find(d => String(d.date) >= today);
  return {
    ...project,
    id: String(project.id),
    sceneCount: scenes.length,
    characterCount,
    nextShootDay: next?.date ?? null
  };
};

export const listProjects = async () => {
  const rows = await store.list("projects");
  rows.sort((a,b) => String(a.title).localeCompare(String(b.title)));
  return (await Promise.all(rows.map(p => overview(p.id)))).filter(Boolean);
};

export const createProject = async (x: Input) => overview((await store.create("projects", clean(x))).id);

export const updateProject = async (id: number, x: Input) => {
  if (!(await store.get("projects", String(id)))) return null;
  await store.put("projects", String(id), clean(x));
  return overview(id);
};

export const deleteProject = async (id: number) => {
  if (!(await store.get("projects", String(id)))) return false;
  for (const collection of ["scenes","shootDays","budgetItems","callSheets","scriptNotes"]) {
    for (const row of await store.query(collection, x => Number(x.projectId) === Number(id))) {
      await store.delete(collection, row.id);
    }
  }
  await store.delete("projects", String(id));
  return true;
};

export const getProjectOverview = overview;
