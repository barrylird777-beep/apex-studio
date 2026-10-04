export const CREWS = Object.freeze({
  bibleFinder: {
    id: "bible-finder",
    name: "Bible Finder Crew",
    sourceOfTruth: "canonical-scripture",
    stages: [
      "BIBLE_FIND","SCRIPTURE_VERIFY","BIBLE_CONTEXT_RESEARCH","CHARACTER_RESEARCH",
      "LOCATION_RESEARCH","POPCORN_DISCOVERY","POPCORN_VERIFY"
    ]
  },
  production: {
    id: "production",
    name: "Production Crew",
    stages: [
      "STORY_BREAKDOWN","CHARACTER_CASTING","SHOT_PLANNING","ASSET_GENERATION",
      "SOUND_GENERATION","EDITORIAL_MASTER","PROTOCOB_REVIEW"
    ]
  }
});

export const CREW_TASKS = Object.freeze({
  BIBLE_FIND:{crew:"bible-finder",input:"premise",output:"scripture-evidence"},
  SCRIPTURE_VERIFY:{crew:"bible-finder",input:"scripture-evidence",output:"verified-scripture"},
  BIBLE_CONTEXT_RESEARCH:{crew:"bible-finder",input:"verified-scripture",output:"context-packet"},
  CHARACTER_RESEARCH:{crew:"bible-finder",input:"verified-scripture",output:"character-packet"},
  LOCATION_RESEARCH:{crew:"bible-finder",input:"verified-scripture",output:"location-packet"},
  POPCORN_DISCOVERY:{crew:"bible-finder",input:"verified-scripture",output:"popcorns"},
  POPCORN_VERIFY:{crew:"bible-finder",input:"popcorns",output:"verified-popcorns"},
  STORY_BREAKDOWN:{crew:"production",input:"scripture-evidence",output:"scene-drafts"},
  CHARACTER_CASTING:{crew:"production",input:"scene-drafts",output:"characters"},
  SHOT_PLANNING:{crew:"production",input:"scene-drafts",output:"shot-plan"},
  ASSET_GENERATION:{crew:"production",input:"shot-plan",output:"video-shot"},
  SOUND_GENERATION:{crew:"production",input:"scene-drafts",output:"audio-scene"},
  EDITORIAL_MASTER:{crew:"production",input:"video-shot+audio-scene",output:"final-master"},
  PROTOCOB_REVIEW:{crew:"production",input:"concept-artifact",output:"user-approval"}
});

export function getCrewTask(task){
  const key=String(task||"").toUpperCase();
  const spec=CREW_TASKS[key];
  if(!spec) throw new Error("Unknown crew task: "+key);
  return {task:key,...spec};
}
