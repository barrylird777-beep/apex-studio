export function monoCompatibleWidth({ width = 0.25, pan = 0, law = "mid-side" } = {}) {
  const w = Math.max(0, Math.min(1, Number(width)));
  const p = Math.max(-1, Math.min(1, Number(pan)));
  return {
    algorithm: law,
    width: w,
    pan: p,
    monoSafe: true,
    rule: "width is represented as a side component; mono fold-down retains the mid component",
    leftGain: Math.sqrt(0.5) * (1 + w * (1 - p)),
    rightGain: Math.sqrt(0.5) * (1 + w * (1 + p))
  };
}
