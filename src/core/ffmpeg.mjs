import ffmpeg from 'fluent-ffmpeg';
import path from 'node:path';

export const PROD_SETTINGS = {
  audio: { bitrate: '320k', frequency: 48000, channels: 2, masterLoudness: 'loudnorm=I=-16:LRA=11:TP=-1.5' },
  video: { codec: 'libx264', preset: 'veryslow', crf: 17, fps: 24, colorGrade: 'eq=contrast=1.15:brightness=-0.02:saturation=1.2' }
};

export function configureProductionExport(command) {
  return command
    .videoCodec(PROD_SETTINGS.video.codec)
    .audioCodec('aac')
    .audioFrequency(PROD_SETTINGS.audio.frequency)
    .audioChannels(PROD_SETTINGS.audio.channels)
    .audioBitrate(PROD_SETTINGS.audio.bitrate)
    .outputOptions([
      '-af', PROD_SETTINGS.audio.masterLoudness,
      '-vf', PROD_SETTINGS.video.colorGrade,
      '-pix_fmt', 'yuv420p',
      '-crf', String(PROD_SETTINGS.video.crf),
      '-preset', PROD_SETTINGS.video.preset,
      '-profile:v', 'high',
      '-level', '4.2',
      '-movflags', '+faststart'
    ]);
}

export async function masterSoundtrack(timelineAudioItems = [], bgmPath, outputPath) {
  if (!bgmPath || !outputPath) throw new Error('BGM and output paths are required');
  const items = Array.isArray(timelineAudioItems) ? timelineAudioItems.filter(item => item && item.filePath) : [];
  return new Promise((resolve, reject) => {
    const command = ffmpeg().input(bgmPath);
    let filterGraph = '[0:a]volume=0.25[bgm];';
    const mixInputs = ['[bgm]'];

    items.forEach((item, index) => {
      command.input(item.filePath);
      const inputIndex = index + 1;
      const delayMs = Math.max(0, Number(item.startTimeMs) || 0);
      filterGraph += '[' + inputIndex + ':a]volume=1.5,adelay=' + delayMs + '|' + delayMs + '[v' + inputIndex + '];';
      mixInputs.push('[v' + inputIndex + ']');
    });

    filterGraph += mixInputs.join('') + 'amix=inputs=' + mixInputs.length + ':duration=first:dropout_transition=2[mixed];';
    filterGraph += '[mixed]' + PROD_SETTINGS.audio.masterLoudness + '[final_audio]';

    command.complexFilter(filterGraph).map('[final_audio]')
      .audioCodec('aac').audioBitrate(PROD_SETTINGS.audio.bitrate)
      .audioFrequency(PROD_SETTINGS.audio.frequency).audioChannels(PROD_SETTINGS.audio.channels)
      .outputOptions(['-movflags', '+faststart']).save(outputPath)
      .on('end', () => resolve(outputPath)).on('error', reject);
  });
}

export async function masterFinalVideo(stitchedVideoPath, masteredAudioPath, outputPath, format = '4k') {
  if (!stitchedVideoPath || !masteredAudioPath || !outputPath) throw new Error('Video, mastered audio, and output paths are required');
  const preset = OUTPUT_PRESETS[format] || OUTPUT_PRESETS['4k'];
  return new Promise((resolve, reject) => {
    ffmpeg().input(stitchedVideoPath).input(masteredAudioPath)
      .videoCodec(preset.videoCodec).audioCodec(preset.audioCodec)
      .audioBitrate(PROD_SETTINGS.audio.bitrate).audioFrequency(PROD_SETTINGS.audio.frequency)
      .audioChannels(PROD_SETTINGS.audio.channels)
      .outputOptions([
        '-preset', PROD_SETTINGS.video.preset, '-crf', String(PROD_SETTINGS.video.crf),
        '-r', String(preset.fps), '-vf', PROD_SETTINGS.video.colorGrade,
        '-pix_fmt', 'yuv420p', '-profile:v', preset.profile, '-level', preset.level,
        '-map', '0:v:0', '-map', '1:a:0', '-shortest', '-movflags', '+faststart'
      ])
      .save(outputPath).on('end', () => resolve(outputPath)).on('error', reject);
  });
}

export const OUTPUT_PRESETS = Object.freeze({
  master: { width: 3840, height: 2160, fps: 24, videoCodec: 'libx264', audioCodec: 'aac', profile: 'high', level: '5.2' },
  '4k': { width: 3840, height: 2160, fps: 24, videoCodec: 'libx264', audioCodec: 'aac', profile: 'high', level: '5.2' },
  'youtube-4k': { width: 3840, height: 2160, fps: 24, videoCodec: 'libx264', audioCodec: 'aac', profile: 'high', level: '5.2' },
  'youtube-1080p': { width: 1920, height: 1080, fps: 24, videoCodec: 'libx264', audioCodec: 'aac', profile: 'high', level: '4.2' },
  'vertical-1080x1920': { width: 1080, height: 1920, fps: 24, videoCodec: 'libx264', audioCodec: 'aac', profile: 'high', level: '4.2' },
  square: { width: 1080, height: 1080, fps: 24, videoCodec: 'libx264', audioCodec: 'aac', profile: 'high', level: '4.2' }
});

export function buildTimelineFfmpegPlan({ clips = [], format = 'master', output = 'output.mp4' } = {}) {
  const preset = OUTPUT_PRESETS[format] || OUTPUT_PRESETS.master;
  const valid = clips.filter(clip => clip && clip.videoUri);
  if (valid.some(clip => !clip.audioUri)) return { command: 'ffmpeg', args: [], preset, inputCount: valid.length, ready: false, reason: 'Every exported scene must have a persistent audio asset.' };
  if (!valid.length) return { command: 'ffmpeg', args: ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=' + preset.width + 'x' + preset.height + ':r=' + preset.fps, '-t', '1', '-c:v', preset.videoCodec, output], preset, inputCount: 1, ready: false, reason: 'No persistent scene video assets are available.' };

  const args = ['-y'];
  valid.forEach(clip => args.push('-i', path.resolve(clip.videoUri)));
  valid.forEach(clip => args.push('-i', path.resolve(clip.audioUri)));

  const videoFilters = valid.map((_, i) => '[' + i + ':v]scale=' + preset.width + ':' + preset.height + ':force_original_aspect_ratio=decrease,pad=' + preset.width + ':' + preset.height + ':(ow-iw)/2:(oh-ih)/2,setsar=1,eq=contrast=1.15:brightness=-0.02:saturation=1.2[v' + i + ']').join(';');
  const audioFilters = valid.map((_, i) => '[' + (valid.length + i) + ':a]aresample=48000,loudnorm=I=-16:LRA=11:TP=-1.5[a' + i + ']').join(';');
  const videoConcat = valid.map((_, i) => '[v' + i + ']').join('') + 'concat=n=' + valid.length + ':v=1:a=0[v]';
  const audioConcat = valid.map((_, i) => '[a' + i + ']').join('') + 'concat=n=' + valid.length + ':v=0:a=1[a]';
  const filters = [videoFilters, audioFilters, videoConcat, audioConcat].join(';');

  const outputArgs = ['-filter_complex', filters, '-map', '[v]', '-map', '[a]', '-c:v', preset.videoCodec, '-c:a', 'aac',
    '-ar', String(PROD_SETTINGS.audio.frequency), '-ac', String(PROD_SETTINGS.audio.channels), '-b:a', PROD_SETTINGS.audio.bitrate,
    '-pix_fmt', 'yuv420p', '-crf', String(PROD_SETTINGS.video.crf), '-preset', PROD_SETTINGS.video.preset,
    '-profile:v', preset.profile, '-level', preset.level, '-r', String(preset.fps), '-movflags', '+faststart', output];

  return { command: 'ffmpeg', args: args.concat(outputArgs), preset, inputCount: valid.length * 2, ready: true };
}

export function buildFfmpegPlan({ media = [], audio = [], format = 'master', output = 'output.mp4' } = {}) {
  const preset = OUTPUT_PRESETS[format] || OUTPUT_PRESETS.master;
  const video = media.filter(item => item?.uri && item.type !== 'audio');
  const audioInputs = audio.filter(item => item?.uri);
  if (!video.length) return { command: 'ffmpeg', args: ['-y', '-f', 'lavfi', '-i', `color=c=black:s=${preset.width}x${preset.height}:r=${preset.fps}`, '-t', '1', '-c:v', preset.videoCodec, output], preset, inputCount: 1, ready: false, reason: 'No visual media is attached yet.' };

  const args = ['-y'];
  for (const item of video) args.push('-i', path.resolve(item.uri));
  for (const item of audioInputs) args.push('-i', path.resolve(item.uri));
  const videoFilters = video.map((_, index) => `[${index}:v]scale=${preset.width}:${preset.height}:force_original_aspect_ratio=decrease,pad=${preset.width}:${preset.height}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${index}]`);
  const chain = video.map((_, index) => `[v${index}]`).join('') + `concat=n=${video.length}:v=1:a=0[v]`;
  const filters = [...videoFilters, chain];
  const out = ['-filter_complex', filters.join(';'), '-map', '[v]'];
  if (audioInputs.length) {
    const offset = video.length;
    const audioFilters = audioInputs.map((_, index) => `[${offset + index}:a]aresample=48000,loudnorm=I=-16:LRA=11:TP=-1.5[a${index}]`);
    const audioChain = audioInputs.map((_, index) => `[a${index}]`).join('') + `concat=n=${audioInputs.length}:v=0:a=1[a]`;
    filters.push(...audioFilters, audioChain);
    out.unshift('-filter_complex', filters.join(';'), '-map', '[v]', '-map', '[a]', '-c:a', preset.audioCodec, '-shortest');
  } else out.push('-an');
  out.push('-r', String(preset.fps), '-c:v', preset.videoCodec, '-profile:v', preset.profile, '-level', preset.level, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output);
  return { command: 'ffmpeg', args: [...args, ...out], preset, inputCount: video.length + audioInputs.length, ready: true };
}
