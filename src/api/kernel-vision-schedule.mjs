import { apexPureStore } from "../core/apex-pure-store.mjs";
import { sovereignAppFabric } from "../core/sovereign-app-fabric.mjs";
import { autoSchedule, buildCalendar } from "../schedule/rules.js";

const APP_ID = "kernel-vision";
const PROJECT_PREFIX = "schedule-project-";
const SCENE_PREFIX = "schedule-scene-";
const DAY_PREFIX = "schedule-day-";
const ASSIGNMENTS_PREFIX = "schedule-assignments-";
const SEQUENCE_ID = "schedule-sequences";
const PROJECT_STATUSES = new Set(["development", "pre-production", "production", "post"]);
const text = value => String(value ?? "").trim();
const number = value => Number.isInteger(Number(value)) ? Number(value) : null;
const fail = (message, status = 400, code) => Object.assign(new Error(message), { status, code });
const key = (prefix, id) => prefix + String(id);
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

export function createKernelVisionSchedule({ fabric = sovereignAppFabric, store = apexPureStore } = {}) {
  const getRecord = async id => (await fabric.get(APP_ID, id))?.record ?? null;
  const putRecord = async (id, record) => fabric.put(APP_ID, id, record);
  const removeRecord = async id => store.delete("app-" + APP_ID, id);
  const listRecords = async type => (await fabric.list(APP_ID)).map(row => row.record).filter(record => record?.recordType === type);
  const withLock = operation => store.withMutationLock(operation);

  async function nextIdUnlocked(kind) {
    const current = await getRecord(SEQUENCE_ID) || { recordType: "schedule-sequences", project: 0, scene: 0, shootDay: 0, character: 0 };
    const next = Math.max(0, Number(current[kind]) || 0) + 1;
    await putRecord(SEQUENCE_ID, { ...current, recordType: "schedule-sequences", [kind]: next });
    return next;
  }
  async function nextId(kind) {
    return withLock(() => nextIdUnlocked(kind));
  }

  const projectKey = id => key(PROJECT_PREFIX, id);
  const sceneKey = id => key(SCENE_PREFIX, id);
  const dayKey = id => key(DAY_PREFIX, id);
  const assignmentKey = id => key(ASSIGNMENTS_PREFIX, id);

  async function getProject(id) {
    const record = await getRecord(projectKey(id));
    return record?.recordType === "schedule-project" ? { ...record, projectId: Number(record.projectId) } : null;
  }
  async function getScene(id) {
    const record = await getRecord(sceneKey(id));
    return record?.recordType === "schedule-scene" ? { ...record, sceneId: Number(record.sceneId), projectId: Number(record.projectId) } : null;
  }
  async function getDay(id) {
    const record = await getRecord(dayKey(id));
    return record?.recordType === "schedule-day" ? { ...record, shootDayId: Number(record.shootDayId), projectId: Number(record.projectId) } : null;
  }

  function projectView(record) {
    return {
      id: record.projectId,
      title: record.title,
      description: record.description ?? null,
      primaryScripture: record.primaryScripture ?? null,
      status: record.status || "development",
      visualDna: clone(record.visualDna || {}),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }
  function sceneView(record) {
    return {
      id: record.sceneId,
      projectId: record.projectId,
      sceneNumber: record.sceneNumber ?? null,
      title: record.title ?? null,
      scriptureRef: record.scriptureRef,
      location: record.location ?? null,
      charactersPresent: clone(record.charactersPresent || []),
      actionSummary: record.actionSummary ?? null,
      emotionalBeat: record.emotionalBeat ?? null,
      productionNotes: record.productionNotes ?? null,
      estimatedPages: record.estimatedPages ?? null,
      dayOrNight: record.dayOrNight ?? null
    };
  }
  function calendarScene(record) {
    return {
      ...sceneView(record),
      sequence: record.sceneNumber ?? record.sceneId,
      location: { name: record.location || "", timeOfDay: record.dayOrNight || "UNSPECIFIED" }
    };
  }
  function dayView(record) {
    return { id: record.shootDayId, projectId: record.projectId, shootDate: record.shootDate, callTime: record.callTime ?? null, notes: record.notes ?? "" };
  }

  async function listScenesForProject(projectId) {
    return (await listRecords("schedule-scene"))
      .filter(record => Number(record.projectId) === Number(projectId))
      .sort((a, b) => (Number(a.sceneNumber ?? Infinity) - Number(b.sceneNumber ?? Infinity)) || (Number(a.sceneId) - Number(b.sceneId)))
      .map(calendarScene);
  }
  async function listScenes(projectId) {
    return (await listRecords("schedule-scene"))
      .filter(record => Number(record.projectId) === Number(projectId))
      .sort((a, b) => (Number(a.sceneNumber ?? Infinity) - Number(b.sceneNumber ?? Infinity)) || (Number(a.sceneId) - Number(b.sceneId)))
      .map(sceneView);
  }
  async function listDays(projectId) {
    return (await listRecords("schedule-day"))
      .filter(record => Number(record.projectId) === Number(projectId))
      .sort((a, b) => String(a.shootDate).localeCompare(String(b.shootDate)) || Number(a.shootDayId) - Number(b.shootDayId))
      .map(dayView);
  }
  async function listAssignments(projectId) {
    const record = await getRecord(assignmentKey(projectId));
    return (record?.recordType === "schedule-assignments" && Array.isArray(record.assignments) ? record.assignments : [])
      .map(clone)
      .sort((a, b) => Number(a.position) - Number(b.position) || Number(a.sceneId) - Number(b.sceneId));
  }
  async function saveAssignments(projectId, assignments) {
    return putRecord(assignmentKey(projectId), { recordType: "schedule-assignments", projectId: Number(projectId), assignments: clone(assignments) });
  }

  async function getProjectOverview(id) {
    const record = await getProject(id);
    if (!record) return null;
    const scenes = await listScenesForProject(id);
    const characterIds = [...new Set(scenes.flatMap(scene => Array.isArray(scene.charactersPresent) ? scene.charactersPresent : []))];
    const today = new Date().toISOString().slice(0, 10);
    const next = (await listDays(id)).find(day => day.shootDate >= today);
    return { ...projectView(record), sceneCount: scenes.length, characterCount: characterIds.length, nextShootDay: next?.shootDate ?? null };
  }

  async function listProjects() {
    const projects = await listRecords("schedule-project");
    projects.sort((a, b) => String(a.title).localeCompare(String(b.title)));
    return Promise.all(projects.map(project => getProjectOverview(project.projectId)));
  }

  async function createProject(input = {}) {
    const title = text(input.title);
    if (!title) throw fail("Project title is required");
    const id = await nextId("project");
    const now = new Date().toISOString();
    const status = PROJECT_STATUSES.has(input.status) ? input.status : "development";
    await putRecord(projectKey(id), {
      recordType: "schedule-project", projectId: id, title,
      description: text(input.description) || null,
      primaryScripture: text(input.primaryScripture) || null,
      status, visualDna: input.visualDna && typeof input.visualDna === "object" && !Array.isArray(input.visualDna) ? clone(input.visualDna) : {},
      createdAt: now, updatedAt: now
    });
    return getProjectOverview(id);
  }

  async function updateProject(id, input = {}) {
    const current = await getProject(id);
    if (!current) return null;
    const title = text(input.title);
    if (!title) throw fail("Project title is required");
    await putRecord(projectKey(id), {
      ...current, title, description: text(input.description) || null,
      primaryScripture: text(input.primaryScripture) || null,
      status: PROJECT_STATUSES.has(input.status) ? input.status : current.status,
      visualDna: input.visualDna && typeof input.visualDna === "object" && !Array.isArray(input.visualDna) ? clone(input.visualDna) : current.visualDna,
      updatedAt: new Date().toISOString()
    });
    return getProjectOverview(id);
  }

  async function deleteProject(id) {
    const project = await getProject(id);
    if (!project) return false;
    const scenes = await listRecords("schedule-scene");
    const days = await listRecords("schedule-day");
    await withLock(async () => {
      for (const scene of scenes.filter(row => Number(row.projectId) === Number(id))) await removeRecord(sceneKey(scene.sceneId));
      for (const day of days.filter(row => Number(row.projectId) === Number(id))) await removeRecord(dayKey(day.shootDayId));
      const assignments = await getRecord(assignmentKey(id));
      if (assignments) await removeRecord(assignmentKey(id));
      await removeRecord(projectKey(id));
    });
    return true;
  }

  async function createScene(input = {}) {
    const projectId = Number(input.projectId);
    const scriptureRef = text(input.scriptureRef || input.verses);
    if (!scriptureRef) throw fail("scriptureRef is required");
    return withLock(async () => {
      if (!Number.isInteger(projectId) || !await getProject(projectId)) return null;
      const id = await nextIdUnlocked("scene");
      const record = {
        recordType: "schedule-scene", sceneId: id, projectId,
        sceneNumber: input.sceneNumber == null ? null : number(input.sceneNumber),
        title: text(input.title) || null, scriptureRef,
        location: text(input.location) || null,
        charactersPresent: Array.isArray(input.charactersPresent) ? input.charactersPresent.map(Number).filter(Number.isInteger) : [],
        actionSummary: text(input.actionSummary) || null,
        emotionalBeat: input.emotionalBeat == null ? null : (typeof input.emotionalBeat === "string" ? input.emotionalBeat : JSON.stringify(input.emotionalBeat)),
        productionNotes: text(input.productionNotes) || null,
        estimatedPages: input.estimatedPages == null ? null : Number(input.estimatedPages),
        dayOrNight: text(input.dayOrNight) || null
      };
      await putRecord(sceneKey(id), record);
      return sceneView(record);
    });
  }

  async function updateScene(id, input = {}) {
    const current = await getScene(id);
    if (!current) return null;
    const projectId = input.projectId == null ? current.projectId : Number(input.projectId);
    if (!await getProject(projectId)) throw fail("Project not found", 404);
    const scriptureRef = text(input.scriptureRef ?? input.verses ?? current.scriptureRef);
    if (!scriptureRef) throw fail("scriptureRef is required");
    const record = {
      ...current, projectId,
      sceneNumber: input.sceneNumber == null ? current.sceneNumber : number(input.sceneNumber),
      title: input.title == null ? current.title : (text(input.title) || null),
      scriptureRef,
      location: input.location == null ? current.location : (text(input.location) || null),
      charactersPresent: Array.isArray(input.charactersPresent) ? input.charactersPresent.map(Number).filter(Number.isInteger) : current.charactersPresent,
      actionSummary: input.actionSummary == null ? current.actionSummary : (text(input.actionSummary) || null),
      emotionalBeat: input.emotionalBeat == null ? current.emotionalBeat : (typeof input.emotionalBeat === "string" ? input.emotionalBeat : JSON.stringify(input.emotionalBeat)),
      productionNotes: input.productionNotes == null ? current.productionNotes : (text(input.productionNotes) || null),
      estimatedPages: input.estimatedPages == null ? current.estimatedPages : Number(input.estimatedPages),
      dayOrNight: input.dayOrNight == null ? current.dayOrNight : (text(input.dayOrNight) || null)
    };
    await putRecord(sceneKey(id), record);
    return sceneView(record);
  }

  async function deleteScene(id) {
    const scene = await getScene(id);
    if (!scene) return false;
    await unassignScene(id);
    await removeRecord(sceneKey(id));
    return true;
  }

  async function createShootDay({ projectId, shootDate, callTime = null, notes = "" } = {}) {
    const idProject = Number(projectId);
    const date = text(shootDate);
    const parsedDate = new Date(date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) throw fail("shootDate must be a valid YYYY-MM-DD date");
    return withLock(async () => {
      if (!await getProject(idProject)) return null;
      if ((await listDays(idProject)).some(day => day.shootDate === date)) throw fail("A shoot day already exists for this project and date", 409, "DUPLICATE_DATE");
      const id = await nextIdUnlocked("shootDay");
      const record = { recordType: "schedule-day", shootDayId: id, projectId: idProject, shootDate: date, callTime: text(callTime) || null, notes: String(notes || ""), unit: "1st Unit" };
      await putRecord(dayKey(id), record);
      return dayView(record);
    });
  }

  async function deleteShootDay(id) {
    const day = await getDay(id);
    if (!day) return false;
    await withLock(async () => {
      const assignments = await listAssignments(day.projectId);
      await saveAssignments(day.projectId, assignments.filter(assignment => assignment.shootDayId !== day.shootDayId));
      await removeRecord(dayKey(id));
    });
    return true;
  }

  async function assignScenes(shootDayId, sceneIds) {
    const day = await getDay(shootDayId);
    if (!day) throw fail("Shoot day not found", 404, "NOT_FOUND");
    if (!Array.isArray(sceneIds)) throw fail("sceneIds must be an array");
    const ids = [...new Set(sceneIds.map(Number))];
    const scenes = [];
    for (const id of ids) {
      if (!Number.isInteger(id)) throw fail("sceneIds must contain integer ids");
      const scene = await getScene(id);
      if (!scene || scene.projectId !== day.projectId) throw fail("All scenes must belong to the same project as the shoot day", 400, "PROJECT_SCOPE");
      scenes.push(scene);
    }
    return withLock(async () => {
      const assignments = await listAssignments(day.projectId);
      const currentDay = assignments.filter(item => item.shootDayId === day.shootDayId && !ids.includes(item.sceneId));
      const otherDays = assignments.filter(item => item.shootDayId !== day.shootDayId && !ids.includes(item.sceneId));
      const combined = [
        ...otherDays,
        ...currentDay.map((item, position) => ({ ...item, position })),
        ...scenes.map((scene, index) => ({ sceneId: scene.sceneId, shootDayId: day.shootDayId, projectId: day.projectId, position: currentDay.length + index }))
      ];
      await saveAssignments(day.projectId, combined);
      return listAssignments(day.projectId);
    });
  }

  async function unassignScene(sceneId) {
    const scene = await getScene(sceneId);
    if (!scene) return false;
    return withLock(async () => {
      const assignments = await listAssignments(scene.projectId);
      if (!assignments.some(item => item.sceneId === scene.sceneId)) return false;
      const remaining = assignments.filter(item => item.sceneId !== scene.sceneId);
      const grouped = new Map();
      for (const assignment of remaining) {
        if (!grouped.has(assignment.shootDayId)) grouped.set(assignment.shootDayId, []);
        grouped.get(assignment.shootDayId).push(assignment);
      }
      const normalized = [...grouped.values()].flatMap(group => group.sort((a, b) => a.position - b.position).map((item, position) => ({ ...item, position })));
      await saveAssignments(scene.projectId, normalized);
      return true;
    });
  }

  async function reorderDay(shootDayId, sceneIds) {
    const day = await getDay(shootDayId);
    if (!day) throw fail("Shoot day not found", 404, "NOT_FOUND");
    if (!Array.isArray(sceneIds)) throw fail("sceneIds must be an array");
    const ids = [...new Set(sceneIds.map(Number))];
    return withLock(async () => {
      const assignments = await listAssignments(day.projectId);
      const assigned = assignments.filter(item => item.shootDayId === day.shootDayId).map(item => item.sceneId);
      if (assigned.length !== ids.length || assigned.some(id => !ids.includes(id))) throw fail("Order must contain exactly the scenes assigned to this day", 400, "INVALID_ORDER");
      const positions = new Map(ids.map((id, position) => [id, position]));
      const reordered = assignments.map(item => item.shootDayId === day.shootDayId ? { ...item, position: positions.get(item.sceneId) } : item);
      await saveAssignments(day.projectId, reordered);
      return listAssignments(day.projectId);
    });
  }

  async function getCalendar(projectId, options) {
    const project = await getProject(projectId);
    if (!project) return null;
    const scenes = await listScenesForProject(projectId);
    const days = await listDays(projectId);
    const assignments = await listAssignments(projectId);
    return buildCalendar({ days, assignments, scenes, options });
  }

  async function runAutoSchedule(projectId, options) {
    if (!await getProject(projectId)) return null;
    const scenes = await listScenesForProject(projectId);
    const assignments = await listAssignments(projectId);
    const assigned = new Set(assignments.map(assignment => assignment.sceneId));
    const unassigned = scenes.filter(scene => !assigned.has(scene.id));
    const days = await listDays(projectId);
    const result = autoSchedule(unassigned, days.map(day => ({
      ...day,
      existingCount: assignments.filter(assignment => assignment.shootDayId === day.id).length
    })), options);
    for (const item of result.plan) await assignScenes(item.dayId, item.sceneIds);
    return { ...(await getCalendar(projectId, options)), overflow: result.overflow };
  }

  return {
    listProjects, createProject, getProjectOverview, updateProject, deleteProject,
    listScenes, createScene, updateScene, deleteScene,
    listShootDays: listDays, getShootDay: async id => { const day = await getDay(id); return day ? dayView(day) : null; },
    listAssignments,
    getCalendar, createShootDay, deleteShootDay, assignScenes, reorderDay, unassignScene, runAutoSchedule
  };
}

export const kernelVisionSchedule = createKernelVisionSchedule();
