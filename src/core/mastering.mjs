import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs/promises';
import path from 'path';

export const PROD_SETTINGS = {
  audio: {
    bitrate: '320k',
    frequency: 48000,
    channels: 2,
    masterLoudness: 'loudnorm=I=-16:LRA=11:TP=-1.5'
  },
  video: {
    codec: 'libx264',
    preset: 'veryslow',
    crf: 17,
    fps: 24,
    colorGrade: 'eq=contrast=1.15:brightness=-0.02:saturation=1.2'
  }
};

async function ensureParent(outputPath) {
  await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
}

export async function masterSoundtrack(timelineAudioItems = [], bgmPath, outputPath) {
  if (!bgmPath) throw new Error('Background music path is required');
  if (!outputPath) throw new Error('Master soundtrack output path is required');

  const items = Array.isArray(timelineAudioItems) ? timelineAudioItems.filter(item => item?.filePath) : [];
  await ensureParent(outputPath);

  return new Promise((resolve, reject) => {
    const command = ffmpeg().input(bgmPath);
    let filterGraph = '[0:a]volume=0.25[bgm];';
    const mixInputs = ['[bgm]'];

    items.forEach((item, index) => {
      command.input(item.filePath);
      const inputIndex = index + 1;
      const delayMs = Math.max(0, Number(item.startTimeMs) || 0);
      filterGraph += `[${inputIndex}:a]volume=1.5,adelay=${delayMs}|${delayMs}[v${inputIndex}];`;
      mixInputs.push(`[v${inputIndex}]`);
    });

    filterGraph += `${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=2[mixed];`;
    filterGraph += `[mixed]${PROD_SETTINGS.audio.masterLoudness}[final_audio]`;

    command
      .complexFilter(filterGraph)
      .map('[final_audio]')
      .audioCodec('aac')
      .audioBitrate(PROD_SETTINGS.audio.bitrate)
      .audioFrequency(PROD_SETTINGS.audio.frequency)
      .audioChannels(PROD_SETTINGS.audio.channels)
      .outputOptions(['-movflags', '+faststart'])
      .save(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject);
  });
}

export async function masterFinalVideo(stitchedVideoPath, masteredAudioPath, outputPath) {
  if (!stitchedVideoPath) throw new Error('Stitched video path is required');
  if (!masteredAudioPath) throw new Error('Mastered audio path is required');
  if (!outputPath) throw new Error('Final video output path is required');
  await ensureParent(outputPath);

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(stitchedVideoPath)
      .input(masteredAudioPath)
      .videoCodec(PROD_SETTINGS.video.codec)
      .audioCodec('aac')
      .audioBitrate(PROD_SETTINGS.audio.bitrate)
      .audioFrequency(PROD_SETTINGS.audio.frequency)
      .audioChannels(PROD_SETTINGS.audio.channels)
      .outputOptions([
        `-preset`,
        PROD_SETTINGS.video.preset,
        `-crf`,
        String(PROD_SETTINGS.video.crf),
        `-r`,
        String(PROD_SETTINGS.video.fps),
        `-vf`,
        PROD_SETTINGS.video.colorGrade,
        '-pix_fmt',
        'yuv420p',
        '-profile:v',
        'high',
        '-level',
        '4.2',
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-shortest',
        '-movflags',
        '+faststart'
      ])
      .save(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject);
  });
}
