export const KORN_NUTZ = Object.freeze({
  id: "korn-nutz",
  name: "KornNutz",
  purpose: "rating system for Apex movies and shows",
  targetTypes: Object.freeze(["movie", "show"]),
  scale: Object.freeze({ min: 0, max: 10, step: 0.1 }),
  dimensions: Object.freeze(["story", "characters", "visuals", "audio", "entertainment", "rewatchability"])
});

function assertTargetType(type) {
  const value = String(type ?? "").trim().toLowerCase();
  if (!KORN_NUTZ.targetTypes.includes(value)) {
    throw new TypeError("KornNutz targetType must be movie or show");
  }
  return value;
}

function normalizeScore(value, name) {
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 10) {
    throw new TypeError(`KornNutz ${name} must be a number from 0 to 10`);
  }
  return Math.round(score * 10) / 10;
}

export function createKornNutzRating({
  targetId,
  targetType,
  title,
  ratings = {},
  reviewerId = null,
  notes = "",
  evidenceIds = []
} = {}) {
  const id = String(targetId ?? "").trim();
  const name = String(title ?? "").trim();
  if (!id) throw new TypeError("KornNutz targetId is required");
  if (!name) throw new TypeError("KornNutz title is required");
  const type = assertTargetType(targetType);
  if (!ratings || typeof ratings !== "object" || Array.isArray(ratings)) {
    throw new TypeError("KornNutz ratings must be an object");
  }

  const normalizedRatings = {};
  for (const [dimension, value] of Object.entries(ratings)) {
    normalizedRatings[dimension] = normalizeScore(value, dimension);
  }

  const values = Object.values(normalizedRatings);
  const overall = values.length
    ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
    : null;

  return Object.freeze({
    id: `korn-nutz-${id}`,
    system: "apex-studio",
    ratingSystem: KORN_NUTZ.name,
    targetId: id,
    targetType: type,
    title: name,
    ratings: Object.freeze(normalizedRatings),
    overall,
    reviewerId,
    notes: String(notes),
    evidenceIds: Object.freeze([...new Set((Array.isArray(evidenceIds) ? evidenceIds : []).map(String))]),
    ratedAt: new Date().toISOString()
  });
}

export function kornNutzStatus() {
  return {
    ratingSystem: KORN_NUTZ.name,
    purpose: KORN_NUTZ.purpose,
    targetTypes: [...KORN_NUTZ.targetTypes],
    scale: { ...KORN_NUTZ.scale },
    dimensions: [...KORN_NUTZ.dimensions],
    active: true,
    checkedAt: new Date().toISOString()
  };
}
