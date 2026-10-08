export const BIBLE_STUDY_ROOM = Object.freeze({
  id: "bible-study-room",
  name: "Bible Study Room",
  system: "garden-of-apex",
  purpose: "dedicated Scripture study and Bible research room",
  capabilities: Object.freeze([
    "scripture-study",
    "cross-reference",
    "version-comparison",
    "original-language-context",
    "historical-cultural-context",
    "theology-interpretation",
    "source-provenance",
    "study-notes",
    "discoveries",
    "popcorn-candidates",
    "cornnut-evaluation",
    "apexstudio-production-handoff"
  ])
});

const EVIDENCE_STATES = new Set(["KNOWN", "OBSERVED", "INFERRED", "UNKNOWN"]);

function clone(value) {
  return structuredClone(value);
}

function requireText(value, name) {
  const text = String(value ?? "").trim();
  if (!text) throw new TypeError(`${name} is required`);
  return text;
}

export function createBibleStudyRoom({ store = new Map() } = {}) {
  if (!store || typeof store.get !== "function" || typeof store.set !== "function") {
    throw new TypeError("Bible Study Room store must be Map-like");
  }

  const notes = store;

  function putNote(note = {}) {
    const id = requireText(note.id || `study-note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, "note id");
    const evidenceState = String(note.evidenceState || "UNKNOWN").toUpperCase();
    if (!EVIDENCE_STATES.has(evidenceState)) {
      throw new TypeError("evidenceState must be KNOWN, OBSERVED, INFERRED, or UNKNOWN");
    }

    const value = {
      id,
      room: BIBLE_STUDY_ROOM.id,
      passage: String(note.passage || "").trim(),
      question: String(note.question || "").trim(),
      observation: String(note.observation || "").trim(),
      interpretation: String(note.interpretation || "").trim(),
      evidenceState,
      sources: Array.isArray(note.sources) ? clone(note.sources) : [],
      crossReferences: Array.isArray(note.crossReferences) ? clone(note.crossReferences) : [],
      versionComparisons: Array.isArray(note.versionComparisons) ? clone(note.versionComparisons) : [],
      historicalContext: note.historicalContext ? clone(note.historicalContext) : null,
      originalLanguage: note.originalLanguage ? clone(note.originalLanguage) : null,
      theology: note.theology ? clone(note.theology) : null,
      discovery: note.discovery ? clone(note.discovery) : null,
      popcornCandidate: Boolean(note.popcornCandidate),
      cornnutEvaluationId: note.cornnutEvaluationId ?? null,
      productionHandoff: note.productionHandoff ? clone(note.productionHandoff) : null,
      updatedAt: new Date().toISOString()
    };

    notes.set(id, clone(value));
    return clone(value);
  }

  function getNote(id) {
    const value = notes.get(String(id));
    return value ? clone(value) : null;
  }

  function listNotes() {
    return [...notes.keys()].sort().map(getNote);
  }

  function createProductionHandoff(noteId, { title, format = "show", destination = "ApexStudio" } = {}) {
    const note = getNote(noteId);
    if (!note) throw new Error("Bible Study Room note not found");
    note.productionHandoff = {
      destination,
      title: requireText(title || note.passage || "Bible study production candidate", "handoff title"),
      format: requireText(format, "handoff format"),
      sourceRoom: BIBLE_STUDY_ROOM.id,
      handedOffAt: new Date().toISOString()
    };
    notes.set(note.id, clone(note));
    return clone(note.productionHandoff);
  }

  function snapshot() {
    return {
      room: BIBLE_STUDY_ROOM,
      evidenceStates: [...EVIDENCE_STATES],
      notes: listNotes()
    };
  }

  return Object.freeze({ putNote, getNote, listNotes, createProductionHandoff, snapshot });
}

export function bibleStudyRoomStatus() {
  return {
    room: BIBLE_STUDY_ROOM.name,
    roomId: BIBLE_STUDY_ROOM.id,
    system: BIBLE_STUDY_ROOM.system,
    purpose: BIBLE_STUDY_ROOM.purpose,
    capabilities: [...BIBLE_STUDY_ROOM.capabilities],
    evidenceStates: [...EVIDENCE_STATES],
    productionOwner: "ApexStudio",
    active: true,
    checkedAt: new Date().toISOString()
  };
}
