/**
 * Garden of Apex — Cobs production crew.
 *
 * Canon:
 * - Cobs are production crew/workers.
 * - Kernels specialize and develop expertise but are never trapped by specialty.
 * - A Cob may have specialties, but may roam across production domains.
 * - Experience strengthens expertise.
 * - Cobs collaborate through explicit assignments/handoffs.
 * - Protocobs are productions; Cobs are the crew that make them.
 *
 * This module is intentionally separate from the technical AI-agent crew.
 */

export const COB_DOMAINS = Object.freeze([
  "research",
  "scripture",
  "theology",
  "history",
  "story",
  "characters",
  "visuals",
  "visual-fx",
  "cinematics",
  "audio",
  "music",
  "sound",
  "editing",
  "animation",
  "voice",
  "production",
  "quality",
  "publishing"
]);

export const COB_ROLES = Object.freeze([
  ["director", "Director"],
  ["researcher", "Researcher"],
  ["scripture", "Scripture Specialist"],
  ["theology", "Theology Specialist"],
  ["historian", "History Specialist"],
  ["story", "Story Specialist"],
  ["character", "Character Specialist"],
  ["visual", "Visual Specialist"],
  ["vfx", "Visual FX Specialist"],
  ["cinematics", "Cinematics Specialist"],
  ["audio", "Audio Specialist"],
  ["music", "Music Specialist"],
  ["sound", "Sound Specialist"],
  ["editor", "Editor"],
  ["animation", "Animation Specialist"],
  ["voice", "Voice Specialist"],
  ["producer", "Production Specialist"],
  ["qc", "Quality Specialist"],
  ["publisher", "Publishing Specialist"]
]);

const arr = value => Array.isArray(value) ? value : [];
const clean = value => String(value ?? "").trim();

function unique(values) {
  return [...new Set(arr(values).map(clean).filter(Boolean))];
}

function timestamp() {
  return new Date().toISOString();
}

export function createCob(input = {}) {
  const role = clean(input.role) || "producer";
  const specialization = unique(input.specialization?.length ? input.specialization : [role]);
  const expertise = Object.fromEntries(
    specialization.map(domain => [domain, Number(input.expertise?.[domain] ?? 1)])
  );

  return {
    id: clean(input.id) || `cob_${Date.now().toString(36)}`,
    name: clean(input.name) || "Cob",
    role,
    specialization,
    expertise,
    experience: Math.max(0, Number(input.experience) || 0),
    status: clean(input.status) || "available",
    currentWork: null,
    completedWork: 0,
    collaborations: 0,
    createdAt: input.createdAt || timestamp(),
    updatedAt: timestamp()
  };
}

export function createCrew(input = {}) {
  const members = arr(input.members).map(createCob);
  return {
    id: clean(input.id) || `cob-crew_${Date.now().toString(36)}`,
    name: clean(input.name) || "Garden Production Crew",
    members,
    assignments: [],
    handoffs: [],
    createdAt: input.createdAt || timestamp(),
    updatedAt: timestamp()
  };
}

export function addCob(crew, cob) {
  const member = createCob(cob);
  if (arr(crew?.members).some(item => item.id === member.id)) {
    throw new Error(`Cob already exists: ${member.id}`);
  }
  return { ...crew, members: [...arr(crew.members), member], updatedAt: timestamp() };
}

export function recordExperience(crew, cobId, domains = [], amount = 1) {
  const gain = Math.max(0, Number(amount) || 0);
  const domainList = unique(domains);

  return {
    ...crew,
    members: arr(crew.members).map(cob => {
      if (cob.id !== cobId) return cob;

      const expertise = { ...(cob.expertise || {}) };
      for (const domain of domainList) {
        expertise[domain] = Number(expertise[domain] || 0) + gain;
      }

      return {
        ...cob,
        expertise,
        experience: Number(cob.experience || 0) + gain,
        completedWork: Number(cob.completedWork || 0) + 1,
        status: "available",
        currentWork: null,
        updatedAt: timestamp()
      };
    }),
    updatedAt: timestamp()
  };
}

/**
 * Specialization guides ranking; it never restricts where a Cob may work.
 */
export function rankCobs(crew, domain) {
  const target = clean(domain);
  return arr(crew?.members)
    .filter(cob => cob.status === "available" || cob.status === "idle")
    .map(cob => ({
      cob,
      score:
        Number(cob.expertise?.[target] || 0) +
        (arr(cob.specialization).includes(target) ? 10 : 0) +
        Math.min(5, Number(cob.experience || 0) / 10)
    }))
    .sort((a, b) => b.score - a.score)
    .map(item => item.cob);
}

export function assignCob(crew, input = {}) {
  const task = clean(input.task);
  const domain = clean(input.domain) || "production";
  if (!task) throw new Error("Cob assignment requires a task");

  const ranked = rankCobs(crew, domain);
  const selected = input.cobId
    ? ranked.find(cob => cob.id === input.cobId)
    : ranked[0];

  if (!selected) throw new Error("No available Cob can accept the assignment");

  const assignment = {
    id: clean(input.assignmentId) || `assignment_${Date.now().toString(36)}`,
    cobId: selected.id,
    task,
    domain,
    protocobId: clean(input.protocobId) || null,
    status: "assigned",
    createdAt: timestamp(),
    updatedAt: timestamp()
  };

  return {
    ...crew,
    members: arr(crew.members).map(cob =>
      cob.id === selected.id
        ? { ...cob, status: "working", currentWork: assignment.id, updatedAt: timestamp() }
        : cob
    ),
    assignments: [...arr(crew.assignments), assignment],
    updatedAt: timestamp()
  };
}

export function completeCobAssignment(crew, assignmentId, result = {}) {
  const id = clean(assignmentId);
  const assignment = arr(crew.assignments).find(item => item.id === id);
  if (!assignment) throw new Error(`Cob assignment not found: ${id}`);

  const domains = unique([
    assignment.domain,
    ...arr(result.domains)
  ]);

  const completed = {
    ...assignment,
    status: "completed",
    result,
    completedAt: timestamp(),
    updatedAt: timestamp()
  };

  const next = {
    ...crew,
    assignments: arr(crew.assignments).map(item => item.id === id ? completed : item),
    updatedAt: timestamp()
  };

  return recordExperience(next, assignment.cobId, domains, Number(result.experienceGain ?? 1));
}

export function createHandoff(input = {}) {
  const from = clean(input.from);
  const to = clean(input.to);
  if (!from || !to) throw new Error("Cob handoff requires from and to");

  return {
    id: clean(input.id) || `handoff_${Date.now().toString(36)}`,
    from,
    to,
    task: clean(input.task),
    artifactIds: unique(input.artifactIds),
    status: "queued",
    result: null,
    createdAt: timestamp(),
    updatedAt: timestamp()
  };
}

export function queueHandoff(crew, handoff) {
  const item = createHandoff(handoff);
  const members = arr(crew.members).map(cob =>
    cob.id === item.from || cob.id === item.to
      ? { ...cob, collaborations: Number(cob.collaborations || 0) + 1, updatedAt: timestamp() }
      : cob
  );

  return {
    ...crew,
    members,
    handoffs: [...arr(crew.handoffs), item],
    updatedAt: timestamp()
  };
}

export function completeHandoff(crew, handoffId, result = {}) {
  const id = clean(handoffId);
  const exists = arr(crew.handoffs).some(item => item.id === id);
  if (!exists) throw new Error(`Cob handoff not found: ${id}`);

  return {
    ...crew,
    handoffs: arr(crew.handoffs).map(item =>
      item.id === id
        ? { ...item, status: "completed", result, completedAt: timestamp(), updatedAt: timestamp() }
        : item
    ),
    updatedAt: timestamp()
  };
}

export function crewStatus(crew) {
  const members = arr(crew?.members);
  return {
    crewId: crew?.id || null,
    memberCount: members.length,
    available: members.filter(cob => cob.status === "available" || cob.status === "idle").length,
    working: members.filter(cob => cob.status === "working").length,
    completedAssignments: arr(crew?.assignments).filter(item => item.status === "completed").length,
    pendingHandoffs: arr(crew?.handoffs).filter(item => item.status === "queued").length
  };
}
