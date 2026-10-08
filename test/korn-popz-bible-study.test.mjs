import test from "node:test";
import assert from "node:assert/strict";
import { createKornPopzRating, kornPopzStatus } from "../src/core/korn-popz.mjs";
import { createBibleStudyRoom, bibleStudyRoomStatus } from "../src/core/bible-study-room.mjs";

test("KornPopz rates movies and shows", () => {
  const status = kornPopzStatus();
  assert.equal(status.ratingSystem, "KornPopz");
  assert.deepEqual(status.targetTypes, ["movie", "show"]);

  const rating = createKornPopzRating({
    targetId: "movie-1",
    targetType: "movie",
    title: "Test Movie",
    ratings: { story: 9, visuals: 8, audio: 10 }
  });

  assert.equal(rating.ratingSystem, "KornPopz");
  assert.equal(rating.targetType, "movie");
  assert.equal(rating.overall, 9);
});

test("KornPopz rejects non-movie/show targets", () => {
  assert.throws(() => createKornPopzRating({
    targetId: "popcorn-1",
    targetType: "popcorn",
    title: "Not a movie",
    ratings: { story: 8 }
  }));
});

test("GardenOfApex exposes a dedicated Bible Study Room", () => {
  const status = bibleStudyRoomStatus();
  assert.equal(status.room, "Bible Study Room");
  assert.equal(status.system, "garden-of-apex");
  assert.ok(status.capabilities.includes("scripture-study"));
  assert.equal(status.productionOwner, "ApexStudio");

  const room = createBibleStudyRoom();
  const note = room.putNote({
    passage: "Genesis 1",
    question: "What does the passage say?",
    evidenceState: "OBSERVED",
    sources: [{ type: "scripture", reference: "Genesis 1" }],
    popcornCandidate: true
  });

  assert.equal(room.getNote(note.id).evidenceState, "OBSERVED");
  const handoff = room.createProductionHandoff(note.id, { title: "Genesis 1", format: "show" });
  assert.equal(handoff.destination, "ApexStudio");
});
