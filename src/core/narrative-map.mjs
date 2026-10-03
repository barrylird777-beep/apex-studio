import { now, uid } from "./id.mjs";
export function createNarrativeTrack(input = {}) {
  return {
    id: input.id ?? uid("track"),
    projectId: input.projectId ?? null,
    branchId: input.branchId ?? "main",
    timelineId: input.timelineId ?? null,
    title: input.title ?? "Untitled Track",
    blocks: (input.blocks ?? []).map((b, i) => ({
      id: b.id ?? uid("block"),
      index: i,
      text: b.text ?? "",
      visualFrames: b.visualFrames ?? { start: 0, end: 0 },
      vocal: b.vocal ?? {},
      sourceRefs: b.sourceRefs ?? [],
      createdAt: b.createdAt ?? now()
    })),
    createdAt: input.createdAt ?? now()
  };
}
export function mapNarrativeBlock(track, block) {
  if (!track || !block) throw new Error("track and block are required");
  track.blocks.push({ id: block.id ?? uid("block"), index: track.blocks.length, text: block.text ?? "", visualFrames: block.visualFrames ?? { start: 0, end: 0 }, vocal: block.vocal ?? {}, sourceRefs: block.sourceRefs ?? [], createdAt: now() });
  return track;
}
