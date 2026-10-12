import test from "node:test";
import assert from "node:assert/strict";
import { createKornKnobIdea, kornKnobIdeaStatus } from "../src/core/korn-knob-ideas.mjs";

test("KornKnob ideas carry movie potential percentage", () => {
  const status = kornKnobIdeaStatus();
  assert.equal(status.name, "KornKnob");
  assert.equal(status.rating, "movie-potential-percent");
  const idea = createKornKnobIdea({
    title: "Test",
    idea: "A compelling movie idea",
    moviePotentialPercent: 87.5
  });
  assert.equal(idea.moviePotentialPercent, 87.5);
  assert.equal(idea.type, "movie-idea");
});

test("KornKnob rejects invalid movie potential", () => {
  assert.throws(() => createKornKnobIdea({
    title: "Bad",
    idea: "Invalid",
    moviePotentialPercent: 101
  }));
});
