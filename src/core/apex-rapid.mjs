import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const VIDEO_EXT=/\.(mp4|mov|m4v|mkv|webm)$/i;
export const APEX_RAPID_PROFILE=Object.freeze({
  priceUsd:25,
  previewSeconds:10,
  paidOutputSeconds:30,
  aspectRatio:'9:16',
  videoCodec:'libx264',
  audioCodec:'aac',
  container:'mp4'
});

export function buildRapidFfmpegArgs({input,output,duration=30,fps=30,videoBitrate='4500k',audioBitrate='192k'}={}) {
  if(!input||!output) throw new TypeError('input and output are required');
  return ['-y','-i',input,'-t',String(duration),'-vf','scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2','-r',String(fps),'-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-b:v',videoBitrate,'-maxrate',videoBitrate,'-bufsize','2M','-c:a','aac','-b:a',audioBitrate,'-ar','48000','-ac','2','-movflags','+faststart',output];
}

export async function listRapidInputs(dir) {
  const entries=await fs.readdir(dir,{withFileTypes:true}).catch(()=>[]);
  return entries.filter(e=>e.isFile()&&VIDEO_EXT.test(e.name)).map(e=>path.join(dir,e.name)).sort();
}

export function renderRapid({ffmpegPath='ffmpeg',input,output,duration=30}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(ffmpegPath,buildRapidFfmpegArgs({input,output,duration}),{stdio:['ignore','ignore','pipe']});
    let stderr='';
    child.stderr.on('data',b=>{stderr=(stderr+String(b)).slice(-8000);});
    child.once('error',reject);
    child.once('exit',(code,signal)=>code===0?resolve({output,code,signal}):reject(new Error('FFmpeg failed: '+code+' '+signal+' '+stderr)));
  });
}
