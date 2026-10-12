export class DistributedTileRenderer {
  static splitFrameToTiles(width = 3840, height = 2160, tileSize = 1080) {
    const w = Number(width);
    const h = Number(height);
    const size = Number(tileSize);
    if (![w, h, size].every(Number.isFinite) || w <= 0 || h <= 0 || size <= 0) {
      throw new TypeError("width, height, and tileSize must be positive numbers");
    }

    const tiles = [];
    for (let y = 0; y < h; y += size) {
      for (let x = 0; x < w; x += size) {
        tiles.push({
          id: `tile-${tiles.length}`,
          tileX: x,
          tileY: y,
          width: Math.min(size, w - x),
          height: Math.min(size, h - y)
        });
      }
    }
    return tiles;
  }

  static plan(width = 3840, height = 2160, tileSize = 1080, workers = 1) {
    const tiles = this.splitFrameToTiles(width, height, tileSize);
    const concurrency = Math.max(1, Math.floor(Number(workers) || 1));
    return {
      width: Number(width),
      height: Number(height),
      tileSize: Number(tileSize),
      concurrency,
      tileCount: tiles.length,
      tiles
    };
  }
}

export default DistributedTileRenderer;
