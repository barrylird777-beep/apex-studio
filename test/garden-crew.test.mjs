import test from "node:test";
import assert from "node:assert/strict";
import {
  COB_DOMAINS,
  createCob,
  createCrew,
  addCob,
  rankCobs,
  assignCob,
  completeCobAssignment,
  createHandoff,
  queueHandoff,
  completeHandoff,
  crewStatus
} from "../src/garden/crew.mjs";

test("Cobs are production crew with specialties but no movement restriction", () => {
  const specialist = createCob({
    id: "c1",
    name: "Visual Cob",
    role: "visual",
    specialization: ["visuals"],
    expertise: { visuals: 20 }
  });
  const crew = createCrew({ members: [specialist] });

  assert.equal(rankCobs(crew, "audio")[0].id, "c1");
  assert.ok(COB_DOMAINS.includes("audio"));
});

test("specialized Cob is selected for its strongest domain", () => {
  const crew = createCrew({
    members: [
      createCob({ id: "visual", role: "visual", specialization: ["visuals"], expertise: { visuals: 20 } }),
      createCob({ id: "audio", role: "audio", specialization: ["audio"], expertise: { audio: 20 } })
    ]
  });

  const assigned = assignCob(crew, { domain: "audio", task: "Build the scene sound plan" });
  assert.equal(assigned.assignments[0].cobId, "audio");
});

test("completed work increases experience and domain expertise", () => {
  let crew = createCrew({
    members: [createCob({ id: "c1", role: "story", specialization: ["story"], expertise: { story: 3 } })]
  });

  crew = assignCob(crew, { cobId: "c1", domain: "story", task: "Write the scene beat" });
  crew = completeCobAssignment(crew, crew.assignments[0].id, { experienceGain: 2 });

  const cob = crew.members[0];
  assert.equal(cob.experience, 2);
  assert.equal(cob.expertise.story, 5);
  assert.equal(cob.status, "available");
});

test("Cobs collaborate through explicit handoffs", () => {
  let crew = createCrew({
    members: [
      createCob({ id: "a", role: "research" }),
      createCob({ id: "b", role: "visual" })
    ]
  });

  const handoff = createHandoff({
    from: "a",
    to: "b",
    task: "Pass verified visual references",
    artifactIds: ["ref-1"]
  });

  crew = queueHandoff(crew, handoff);
  crew = completeHandoff(crew, handoff.id, { accepted: true });

  assert.equal(crew.handoffs[0].status, "completed");
  assert.equal(crew.members[0].collaborations, 1);
  assert.equal(crew.members[1].collaborations, 1);
});

test("Cobs can be added without duplicating identity", () => {
  let crew = createCrew();
  crew = addCob(crew, { id: "new-cob", role: "producer" });
  assert.throws(() => addCob(crew, { id: "new-cob", role: "producer" }), /already exists/);
});

test("crew status reports production state", () => {
  const crew = createCrew({
    members: [
      createCob({ id: "a", status: "available" }),
      createCob({ id: "b", status: "working" })
    ]
  });
  const status = crewStatus(crew);
  assert.equal(status.memberCount, 2);
  assert.equal(status.available, 1);
  assert.equal(status.working, 1);
});
