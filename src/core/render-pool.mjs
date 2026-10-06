import { buildRenderPool } from './render-performance.mjs';

export function createRenderPool({ concurrency = 1 } = {}) {
  return buildRenderPool({ concurrency });
}
