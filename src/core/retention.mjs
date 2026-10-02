import { uid, now } from "./id.mjs";

export const RETENTION_OPENING_SECONDS=30;
export const RETENTION_BEATS=Object.freeze([
 {start:0,end:3,name:"pattern_interrupt",goal:"Create immediate curiosity with a striking visual, question, or moment."},
 {start:3,end:8,name:"stakes",goal:"Make the viewer understand what could be lost, gained, revealed, or changed."},
 {start:8,end:15,name:"mystery",goal:"Open a specific unanswered question without falsely implying facts Scripture does not state."},
 {start:15,end:23,name:"escalation",goal:"Increase tension through verified story context, consequence, or a carefully labeled dramatization."},
 {start:23,end:30,name:"promise",goal:"Give a clear reason to keep watching and transition naturally into the story."}
]);

export function buildRetentionPrompt({title="",passage="",storySummary="",tone="cinematic, reverent, emotionally gripping",audience="general audience"}={}){
 return `Create the opening 30 seconds of a Bible-story video titled "${title}".

SOURCE/PASSAGE:
${passage}

STORY CONTEXT:
${storySummary}

AUDIENCE:
${audience}

TONE:
${tone}

NON-NEGOTIABLE RETENTION STRUCTURE:
0-3s — PATTERN INTERRUPT: begin immediately. No logo, greeting, channel intro, or "in today's video." Use a compelling visual or line that creates an immediate question.
3-8s — STAKES: establish why this moment matters.
8-15s — MYSTERY: create a concrete unanswered question the story will answer.
15-23s — ESCALATION: intensify the situation using only verified biblical context unless a creative reconstruction is explicitly labeled as dramatization.
23-30s — PROMISE: create a strong open loop and transition into the first story scene.

RULES:
- Hook in the first sentence/visual.
- Do not spend the first 30 seconds explaining the premise.
- Do not fabricate quotations, events, motivations, dialogue, historical facts, miracles, or biblical details.
- Never present invented dialogue as Scripture.
- If dramatization is used, make the distinction clear in the underlying production metadata.
- Prefer a question, unresolved danger, surprising contrast, impossible-seeming situation, emotional decision, or consequential revelation when supported by the source.
- Use short, speakable narration.
- Every visual beat must be filmable.
- The final 2-3 seconds should naturally make the viewer want the next scene rather than ending the hook.
- The opening should feel like part of the story, not an advertisement.

OUTPUT:
Return:
1. Narration with timestamps.
2. Visual direction for each beat.
3. Sound/music direction.
4. The open loop being created.
5. The exact Scripture/source references supporting factual claims.
6. A label for any dramatized or inferred material.`;
}

export function createRetentionOpening(input={}){
 const prompt=buildRetentionPrompt(input);
 return {id:uid("hook"),durationSeconds:30,prompt,beats:RETENTION_BEATS,createdAt:now(),updatedAt:now()};
}
