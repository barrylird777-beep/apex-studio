import crypto from "node:crypto";\nimport { createMusicRadarHandoff } from "../core/music/music-radar-contract.mjs";

export function createMusicRadarBridge({ enqueueWorkerTask, getGardenPackage } = {}) {
  return {
    async status() {
      return {
        ok: true,
        app: "Music Radar",
        contractVersion: "music-radar-studio-handoff.v1",
        standalone: true,
        integrations: {
          gardenOfApex: Boolean(getGardenPackage),
          apexStudio: Boolean(enqueueWorkerTask)
        }
      };
    },

    async handoff(input = {}) {
      const handoff = createMusicRadarHandoff(input);
      if (handoff.contentDomain === "korn" && getGardenPackage) {
        const garden = await getGardenPackage();
        handoff.worldPackage = {
          system: "garden-of-apex",
          graphVersion: garden.graphVersion,
          packageHash: garden.packageHash,
          references: garden.references
        };
      }
      if (!enqueueWorkerTask) {
        return { queued: false, durable: false, handoff };
      }
      const jobId = crypto.randomUUID();
      await enqueueWorkerTask({
        id: jobId,
        workerId: "music-radar-bridge",
        role: "audio-production",
        task: "music-audio-handoff",
        payload: { handoff },
        maxAttempts: 5,
        dedupeKey: `music-radar:${handoff.projectId}:${handoff.assets.map(x => x.assetId).join(",")}`
      });
      return { queued: true, durable: true, jobId, handoff };
    }
  };
}
