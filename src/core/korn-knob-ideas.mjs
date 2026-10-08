export const KORN_KNOB_IDEA = Object.freeze({
  name: "KornKnob",
  purpose: "idea that pops up inside the Apex app",
  targetType: "movie-idea",
  rating: "movie-potential-percent"
});

function text(value, name) {
  const result = String(value ?? "").trim();
  if (!result) throw new TypeError(`${name} is required`);
  return result;
}

function percent(value) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || result > 100) {
    throw new TypeError("moviePotentialPercent must be between 0 and 100");
  }
  return Math.round(result * 10) / 10;
}

export function createKornKnobIdea({ title, idea, moviePotentialPercent, source = "app" } = {}) {
  return Object.freeze({
    id: `korn-knob-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: KORN_KNOB_IDEA.targetType,
    name: KORN_KNOB_IDEA.name,
    title: text(title, "title"),
    idea: text(idea, "idea"),
    moviePotentialPercent: percent(moviePotentialPercent),
    source: text(source, "source"),
    createdAt: new Date().toISOString()
  });
}

export function kornKnobIdeaStatus() {
  return {
    name: KORN_KNOB_IDEA.name,
    purpose: KORN_KNOB_IDEA.purpose,
    targetType: KORN_KNOB_IDEA.targetType,
    rating: KORN_KNOB_IDEA.rating,
    active: true,
    checkedAt: new Date().toISOString()
  };
}
