export const ENCODERS = Object.freeze({nvenc:{codec:'h264_nvenc',hardware:true},vaapi:{codec:'h264_vaapi',hardware:true},videotoolbox:{codec:'h264_videotoolbox',hardware:true},cpu:{codec:'libx264',hardware:false}});\nexport function is4kMasterCompliant(probe,target={}){const v=probe?.video;if(!v)return false;const w=Number(target.width||3840),h=Number(target.height||2160),f=Number(target.fps||24);return v.width>=w&&v.height>=h&&Math.abs(Number(v.fps)-f)<.01&&new Set(target.codecs||['h264','hevc','av1']).has(v.codec)&&v.pixFmt==='yuv420p';}\nexport function selectEncoderFromList(available,preferred='auto'){const list=Array.isArray(available)?available:[];if(preferred!=='auto'&&ENCODERS[preferred]&&(preferred==='cpu'||list.includes(preferred)))return{name:preferred,...ENCODERS[preferred]};const name=list.find(x=>ENCODERS[x]?.hardware)||'cpu';return{name,...ENCODERS[name]};}\n

export function buildRenderPool({ concurrency = 1 } = {}) {
  const limit = Math.max(1, Math.floor(Number(concurrency) || 1));
  let active = 0;
  const queue = [];
  const pump = () => {
    while (active < limit && queue.length) {
      const task = queue.shift();
      active++;
      Promise.resolve().then(task.run).then(task.resolve, task.reject).finally(() => { active--; pump(); });
    }
  };
  return {
    get active() { return active; },
    get queued() { return queue.length; },
    get capacity() { return limit - active; },
    run(fn) {
      return new Promise((resolve, reject) => {
        queue.push({ run: fn, resolve, reject });
        pump();
      });
    }
  };
}


export function buildRenderProfile({ availableEncoders = [], preferredEncoder = 'auto', concurrency = 4 } = {}) {
  const encoder = selectEncoderFromList(availableEncoders, preferredEncoder);
  const limit = Math.max(1, Math.min(16, Math.floor(Number(concurrency) || 4)));
  return Object.freeze({
    encoder,
    concurrency: encoder.hardware ? limit : Math.min(limit, 4),
    hardware: encoder.hardware
  });
}

export function shouldStreamCopy({ probe, format = '4k' } = {}) {
  const preset = format === '4k' || format === 'master' || format === 'youtube-4k'
    ? { width: 3840, height: 2160, fps: 24, codecs: ['h264', 'hevc', 'av1'] }
    : {};
  return is4kMasterCompliant(probe, preset);
}
