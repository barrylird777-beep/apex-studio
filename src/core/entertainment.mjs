import { uid, now } from "./id.mjs";

export const ENTERTAINMENT_SIGNALS=Object.freeze([
  "curiosity","stakes","emotion","spectacle","escalation","surprise","payoff","pacing","sound_design"
]);

const SIGNAL_TERMS=Object.freeze({
  curiosity:["question","mystery","unknown","unanswered","wonder","why","how"],
  stakes:["danger","risk","loss","threat","consequence","cost","save","destroy","die","death"],
  emotion:["fear","grief","joy","hope","anger","love","sorrow","despair","relief","decision"],
  spectacle:["battle","storm","fire","light","darkness","giant","angel","miracle","sea","mountain","king","crowd","thunder"],
  escalation:["then","but","suddenly","however","until","worse","closer","rises","surround","chase"],
  surprise:["reveal","unexpected","instead","turn","secret","shocking","surprise","discovery"],
  payoff:["payoff","answers","fulfilled","returns","callback","reward","victory","resolved","resolution"],
  sound_design:["music","score","sound","silence","impact","thunder","whisper","roar","footstep","sfx"]
});

function textOf(value){
  if(value==null) return "";
  if(typeof value==="string") return value;
  if(Array.isArray(value)) return value.map(textOf).join(" ");
  if(typeof value==="object") return Object.values(value).map(textOf).join(" ");
  return String(value);
}

function hasSignal(text,terms){
  if(!Array.isArray(terms)||terms.length===0) return false;
  const value=text.toLowerCase();
  return terms.some(term=>value.includes(term));
}

function durationOf(shot){
  const n=Number(shot?.duration);
  return Number.isFinite(n)&&n>0?n:null;
}

export function auditEntertainment(episode={}){
  const hook=textOf(episode.hook);
  const script=textOf(episode.script);
  const scenes=Array.isArray(episode.scenes)?episode.scenes:[];
  const shots=Array.isArray(episode.storyboard)?episode.storyboard:[];
  const audio=Array.isArray(episode.audio)?episode.audio:[];
  const combined=[hook,script,textOf(scenes),textOf(shots),textOf(audio),textOf(episode.storySummary)].join(" ").trim();

  const signals=ENTERTAINMENT_SIGNALS.map(name=>({
    name,
    present:hasSignal(combined,SIGNAL_TERMS[name])
  }));

  const durations=shots.map(durationOf).filter(Boolean);
  const uniqueDurations=new Set(durations.map(x=>Math.round(x*10)/10));
  const pacing=durations.length>=3 && (uniqueDurations.size>=2 || durations.some(x=>x<=2.5)&&durations.some(x=>x>=5));

  const openLoop=/(open loop|unanswered|question|mystery|promise|keep watching|find out|what happens)/i.test(hook);
  const sourceRefs=Array.isArray(episode.sourceRefs)?episode.sourceRefs.length>0:false;
  const dramatizationDisclosure=/(dramatiz|reconstruct|inferred|tradition|paraphrase)/i.test(combined);
  const exposition=/(background|exposition|explaining|history lesson|long explanation)/i.test(combined);
  const emptyHook=!hook.trim();
  const checks=[
    {name:"hook",ok:!emptyHook,detail:emptyHook?"Create the cold open before production.":"Cold open exists."},
    {name:"open_loop",ok:openLoop,detail:openLoop?"A curiosity/open-loop cue is present.":"Add a concrete unanswered question or promise."},
    ...signals.map(x=>({name:x.name,ok:x.present,detail:x.present?"Signal detected.":"Add this signal where the source supports it."})),
    {name:"pacing_variation",ok:pacing,detail:pacing?"Shot durations vary.":"Use meaningful pacing variation; avoid a flat shot rhythm."},
    {name:"sound_design",ok:signals.find(x=>x.name==="sound_design")?.present??false,detail:"Plan music, silence, impacts, ambience, or other purposeful sound."},
    {name:"source_provenance",ok:sourceRefs,detail:sourceRefs?"Source references are attached.":"Attach Scripture/source references before release."},
    {name:"dramatization_boundary",ok:!dramatizationDisclosure||Boolean(episode.provenance?.rules?.length),detail:dramatizationDisclosure?"Dramatized/inferred material must remain explicitly labeled.":"No dramatization cue detected."},
    {name:"filler_control",ok:!exposition,detail:exposition?"Reduce exposition and convert background information into visual storytelling.":"No obvious filler/exposition cue detected."}
  ];
  const failed=checks.filter(x=>!x.ok).map(x=>x.name);
  return {
    id:uid("entertainment-audit"),
    createdAt:now(),
    ready:failed.length===0,
    signals,
    checks,
    failed,
    stats:{
      scenes:scenes.length,
      shots:shots.length,
      audioTracks:audio.length,
      variedShotDurations:uniqueDurations.size,
      totalShotSeconds:durations.reduce((sum,x)=>sum+x,0)
    }
  };
}

export function buildEntertainmentPrompt({title="",passage="",storySummary="",tone="cinematic, reverent, emotionally gripping"}={}){
  return `Design an entertaining Bible-story episode for "${title}".

SOURCE/PASSAGE:
${passage}

STORY SUMMARY:
${storySummary}

TONE:
${tone}

ENTERTAINMENT ENGINE:
- Open with immediate curiosity; no logo, greeting, or filler.
- Escalate through stakes, emotion, spectacle, surprise, and meaningful reversals.
- Give major sequences a question, conflict, reveal, emotional turn, spectacle, reversal, or payoff.
- Vary shot scale, movement, silence, music, impact, and scene length.
- Use callbacks and earned payoffs instead of empty cliffhangers.
- Prefer visual storytelling over explanatory narration.
- Keep the viewer oriented while preserving mystery.
- Scripture is the source of truth: never invent dialogue, events, motives, miracles, chronology, or facts merely to increase entertainment.
- Clearly label paraphrase, inference, history, tradition, and dramatization in production metadata.

OUTPUT:
1. Story beats with purpose.
2. Retention/open-loop moments.
3. Emotional turns.
4. Visual spectacle opportunities grounded in the source.
5. Sound-design opportunities.
6. Payoffs and callbacks.
7. Exact source references for factual claims.`;
}
