export const DEFAULT_MAX_SCENES_PER_DAY = 8;

export function analyzeDay(scenes, { maxScenes = DEFAULT_MAX_SCENES_PER_DAY } = {}) {
  const warnings = [];
  if (scenes.length > maxScenes) warnings.push({ code: "OVERLOADED", message: `${scenes.length} scenes scheduled (suggested max ${maxScenes})` });
  const locations = [...new Set(scenes.map(s => s.location?.name).filter(Boolean))];
  if (locations.length > 1) warnings.push({ code: "COMPANY_MOVE", message: `${locations.length} locations: ${locations.join(", ")}` });
  const times = new Set(scenes.map(s => s.location?.timeOfDay).filter(t => t && t !== "UNSPECIFIED"));
  if (times.has("NIGHT") && (times.has("DAY") || times.has("DAWN"))) warnings.push({ code: "DAY_NIGHT_MIX", message: "Day and night scenes on the same shoot day" });
  return warnings;
}

export function buildCalendar({ days, assignments, scenes, options }) {
  const sceneById = new Map(scenes.map(s => [s.id, s]));
  const byDay = new Map(), assignedIds = new Set(), missingSceneIds = [];
  for (const a of [...assignments].sort((x,y) => x.position-y.position)) {
    const scene = sceneById.get(a.sceneId);
    if (!scene) { missingSceneIds.push(a.sceneId); continue; }
    assignedIds.add(a.sceneId);
    if (!byDay.has(a.shootDayId)) byDay.set(a.shootDayId, []);
    byDay.get(a.shootDayId).push(scene);
  }
  const calendarDays = [...days].sort((a,b) => a.shootDate.localeCompare(b.shootDate)).map(day => {
    const dayScenes = byDay.get(day.id) ?? [];
    return { ...day, scenes: dayScenes, warnings: analyzeDay(dayScenes, options) };
  });
  const unassigned = scenes.filter(s => !assignedIds.has(s.id)).sort((a,b) => a.sequence-b.sequence);
  return { days: calendarDays, unassigned, missingSceneIds, summary: { totalScenes: scenes.length, assigned: assignedIds.size, unassigned: unassigned.length } };
}

export function autoSchedule(scenes, days, { maxScenes = DEFAULT_MAX_SCENES_PER_DAY } = {}) {
  const groups = new Map();
  for (const s of [...scenes].sort((a,b) => a.sequence-b.sequence)) {
    const key = s.location?.name ?? "unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const plan = days.map(d => ({ dayId: d.id, existing: d.existingCount ?? 0, sceneIds: [] }));
  const load = i => plan[i].existing + plan[i].sceneIds.length;
  const overflow = [];
  let d = 0;
  for (const group of groups.values()) {
    if (d < plan.length && group.length <= maxScenes && load(d) + group.length > maxScenes) d++;
    for (const scene of group) {
      while (d < plan.length && load(d) >= maxScenes) d++;
      if (d >= plan.length) overflow.push(scene.id);
      else plan[d].sceneIds.push(scene.id);
    }
  }
  return { plan: plan.filter(p => p.sceneIds.length).map(({dayId,sceneIds}) => ({dayId,sceneIds})), overflow };
}
