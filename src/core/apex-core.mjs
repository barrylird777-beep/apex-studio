export const APEX_CORE_HIERARCHY = Object.freeze([
  "God",
  "Scripture and truth",
  "Jesus Christ and Christian faith identity",
  "Meaning and human value",
  "Story and reverent dramatization",
  "Entertainment and viewer experience",
  "Virality and growth",
  "Production and business"
]);

export const APEX_CORE_PRINCIPLES = Object.freeze({
  foundation: "God is the ultimate center of Apex.",
  scripture: "Scripture and source truth outrank creative invention.",
  christ: "Apex may explicitly express its Christian identity and center Jesus Christ.",
  stewardship: "Entertainment, virality, growth, and revenue are stewardship objectives, not the foundation.",
  humanAuthority: "Apex assists and recommends; final human authority remains intact.",
  integrity: "No growth objective should require falsifying, obscuring, or corrupting source truth."
});

export function apexCoreContract() {
  return {
    version: "1.0.0",
    hierarchy: [...APEX_CORE_HIERARCHY],
    principles: { ...APEX_CORE_PRINCIPLES }
  };
}

export function auditApexCoreContract(episode = {}) {
  const blockers = [];
  const provenance = episode.provenance ?? {};
  const rules = Array.isArray(provenance.rules) ? provenance.rules : [];
  const hasSourceDiscipline = Boolean(episode.passage || episode.sourceRefs?.length);
  if (!hasSourceDiscipline) blockers.push({ code: "core-source-missing", message: "Apex core requires a Scripture source or source references." });
  if (!rules.some(rule => String(rule).toLowerCase().includes("scripture"))) {
    blockers.push({ code: "core-scripture-rule-missing", message: "Apex core requires an explicit Scripture/source-truth boundary." });
  }
  return { ready: blockers.length === 0, blockers, contract: apexCoreContract() };
}
