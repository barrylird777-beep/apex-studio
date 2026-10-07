export class RaftAccelerator {
  capabilities() { return { hardware: false, raftValidation: false }; }
  async validate(entry) { return { supported: false, entry }; }
}
export class VectorDotProductAccelerator {
  capabilities() { return { hardware: false, dotProduct: false }; }
  async dot(a, b) {
    if (a.length !== b.length) throw new RangeError('vector dimensions differ');
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
    return sum;
  }
}
export class VideoCodecAccelerator {
  capabilities() { return { hardware: false, encode: false, decode: false }; }
  async encode() { throw new Error('native video accelerator backend unavailable'); }
  async decode() { throw new Error('native video accelerator backend unavailable'); }
}
export async function loadHardwareBackend(spec = process.env.APEX_HARDWARE_BACKEND_MODULE) {
  if (!spec) return null;
  const mod = await import(spec);
  const Backend = mod.default || mod.HardwareBackend || mod;
  return new Backend();
}
