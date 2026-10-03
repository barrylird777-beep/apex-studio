import crypto from "node:crypto";
import { DistributedTileRenderer } from "../vision/distributed-tile-renderer.mjs";

export class WaveScalerDaemon {
  constructor({ store } = {}) {
    this.store = store ?? null;
  }

  async unleashMacroWave(waveIntensity = 100) {
    const intensity = Math.max(1, Math.floor(Number(waveIntensity) || 1));
    if (!this.store) throw new Error("WaveScalerDaemon requires a distributed store instance.");
    await this.store.connect();
    await this.store.initEnterpriseSchema();

    const batchId = crypto.randomUUID();
    const tiles = DistributedTileRenderer.splitFrameToTiles(3840, 2160, 1080);
    let dispatchedCount = 0;

    for (let wave = 0; wave < intensity; wave++) {
      for (let i = 0; i < tiles.length; i++) {
        await this.store.enqueueJob("macro_wave_tile_render", {
          batchId, waveIndex: wave, tileIndex: i, coordinates: tiles[i]
        }, 1000);
        dispatchedCount++;
      }
    }

    return { batchId, totalJobs: dispatchedCount, tileCount: tiles.length, waveIntensity: intensity, status: "MACRO_WAVE_FLOOD_ACTIVE" };
  }
}

export default WaveScalerDaemon;
