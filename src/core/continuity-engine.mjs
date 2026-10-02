import { uid, now } from "./id.mjs";

export const CONTINUITY_SEVERITIES = Object.freeze(["info", "warning", "blocker"]);

const arr = value => Array.isArray(value) ? value : [];
const read = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);

const makeIssue = (input = {}) => ({
  id: input.id ?? uid("continuity"),
  severity: input.severity ?? "blocker",
  domain: input.domain ?? "canon",
  code: String(input.code ?? "continuity-conflict"),
  message: String(input.message ?? ""),
  entityId: input.entityId ?? null,
  expected: input.expected ?? null,
  actual: input.actual ?? null,
  sourceRefs: arr(input.sourceRefs),
  createdAt: now()
});

export function compareLockedCanon(canon = {}, episode = {}) {
  const issues = [];
  const used = new Set(arr(episode.canonEntityIds));

  for (const entity of arr(canon.entities)) {
    if (!used.has(entity.id)) continue;

    if (entity.approved === false) {
      issues.push(makeIssue({
        code: "unapproved-canon",
        entityId: entity.id,
        message: `Unapproved canon entity used: ${entity.name}`,
        sourceRefs: entity.sourceRefs
      }));
    }

    for (const field of arr(entity.locked)) {
      const expected = read(entity.state, field);
      const actual = read(episode, `canonOverrides.${entity.id}.${field}`);
      if (actual !== undefined && JSON.stringify(actual) !== JSON.stringify(expected)) {
        issues.push(makeIssue({
          code: "locked-field-mismatch",
          domain: entity.type,
          entityId: entity.id,
          message: `Locked canon field conflicts: ${field}`,
          expected,
          actual,
          sourceRefs: entity.sourceRefs
        }));
      }
    }
  }

  return issues;
}

export function compareCharacterState(current = {}, previous = {}) {
  const issues = [];

  for (const field of ["appearance", "wardrobe", "age", "traits"]) {
    if (current[field] === undefined || previous[field] === undefined) continue;
    if (JSON.stringify(current[field]) !== JSON.stringify(previous[field])) {
      issues.push(makeIssue({
        severity: "warning",
        domain: "character",
        code: "character-state-drift",
        entityId: current.id,
        message: `Character ${field} changed between continuity checkpoints.`,
        expected: previous[field],
        actual: current[field]
      }));
    }
  }

  return issues;
}

export function auditContinuity({
  canon = {},
  episode = {},
  characters = [],
  previousCharacters = []
} = {}) {
  const issues = compareLockedCanon(canon, episode);
  const previous = new Map(previousCharacters.map(character => [character.id, character]));

  for (const character of characters) {
    const prior = previous.get(character.id);
    if (prior) issues.push(...compareCharacterState(character, prior));
  }

  const blockers = issues.filter(issue => issue.severity === "blocker");
  const warnings = issues.filter(issue => issue.severity === "warning");

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    issues,
    stats: {
      issues: issues.length,
      blockers: blockers.length,
      warnings: warnings.length,
      characters: characters.length,
      canonEntities: arr(canon.entities).length
    }
  };
}

export function continuityReport(input = {}) {
  const audit = auditContinuity(input);
  return {
    status: audit.ready ? "ready" : "blocked",
    summary: `${audit.stats.issues} continuity issue(s), ${audit.stats.blockers} blocker(s), ${audit.stats.warnings} warning(s)`,
    audit
  };
}

export function continuityPrompt({ episode = {}, issues = [] } = {}) {
  return [
    `Repair continuity for episode ${episode.id ?? "unknown"}.`,
    "Preserve locked canon exactly.",
    "Do not silently alter Scripture provenance, chronology, character identity, relationships, wardrobe, props, locations, or established visual facts.",
    `Findings: ${JSON.stringify(issues)}`,
    "Return explicit repairs and identify the continuity rule each repair satisfies."
  ].join(" ");
}
