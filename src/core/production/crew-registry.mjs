export const CREWS = Object.freeze({
  bibleFinder: {
    id: "bible-finder",
    name: "Bible Finder Crew",
    sourceOfTruth: "canonical-scripture",
    stages: [
      "BIBLE_FIND","SCRIPTURE_VERIFY","BIBLE_CONTEXT_RESEARCH",
      "CHARACTER_RESEARCH","LOCATION_RESEARCH","SCENE_BREAKDOWN"
    ]
  },
  production: {
    id: "production",
    name: "Production Crew",
    stages: [
      "SCREENPLAY_DRAFT","SHOT_PLAN","STORYBOARD","ASSET_PLAN",
      "PERFORMANCE_PLAN","VIDEO_GENERATE","EDIT_SCENE","DIALOGUE_AUDIO",
      "MUSIC_SFX","COMPOSITE","COLOR_MASTER","FINAL_MASTER"
    ]
  }
});

export const CREW_TASKS = Object.freeze({
  BIBLE_FIND: { crew:"bible-finder", input:"scriptureReference", output:"scripture-evidence" },
  SCRIPTURE_VERIFY: { crew:"bible-finder", input:"scripture-evidence", output:"verified-scripture" },
  BIBLE_CONTEXT_RESEARCH: { crew:"bible-finder", input:"verified-scripture", output:"context-packet" },
  CHARACTER_RESEARCH: { crew:"bible-finder", input:"verified-scripture", output:"character-packet" },
  LOCATION_RESEARCH: { crew:"bible-finder", input:"verified-scripture", output:"location-packet" },
  SCENE_BREAKDOWN: { crew:"bible-finder", input:"verified-scripture", output:"scene-brief" },
  SCREENPLAY_DRAFT: { crew:"production", input:"scene-brief", output:"screenplay" },
  SHOT_PLAN: { crew:"production", input:"screenplay", output:"shot-plan" },
  STORYBOARD: { crew:"production", input:"shot-plan", output:"storyboard-plan" },
  ASSET_PLAN: { crew:"production", input:"storyboard-plan", output:"asset-plan" },
  PERFORMANCE_PLAN: { crew:"production", input:"asset-plan", output:"performance-plan" },
  VIDEO_GENERATE: { crew:"production", input:"performance-plan", output:"video" },
  EDIT_SCENE: { crew:"production", input:"video", output:"edited-video" },
  DIALOGUE_AUDIO: { crew:"production", input:"screenplay", output:"dialogue-audio" },
  MUSIC_SFX: { crew:"production", input:"edited-video", output:"music-sfx" },
  COMPOSITE: { crew:"production", input:"edited-video", output:"composite" },
  COLOR_MASTER: { crew:"production", input:"composite", output:"color-master" },
  FINAL_MASTER: { crew:"production", input:"color-master", output:"final-master" }
});

export function getCrewTask(task) {
  const key=String(task||"").toUpperCase();
  const spec=CREW_TASKS[key];
  if (!spec) throw new Error("Unknown crew task: "+key);
  return { task:key, ...spec };
}
