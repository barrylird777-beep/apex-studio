import path from "node:path";

export const OUTPUT_PRESETS=Object.freeze({
 master:{width:1920,height:1080,fps:30,videoCodec:"libx264",audioCodec:"aac"},
 "youtube-1080p":{width:1920,height:1080,fps:30,videoCodec:"libx264",audioCodec:"aac"},
 "vertical-1080x1920":{width:1080,height:1920,fps:30,videoCodec:"libx264",audioCodec:"aac"},
 square:{width:1080,height:1080,fps:30,videoCodec:"libx264",audioCodec:"aac"}
});

function q(v){return String(v).replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/\n/g," ");}

export function buildFfmpegPlan({media=[],audio=[],format="master",output="output.mp4"}={}){
 const preset=OUTPUT_PRESETS[format]??OUTPUT_PRESETS.master;
 const inputs=media.filter(m=>m?.uri).map(m=>path.resolve(m.uri));
 const audioInputs=audio.filter(a=>a?.uri).map(a=>path.resolve(a.uri));
 const args=["-y"];
 for(const input of inputs)args.push("-i",input);
 for(const input of audioInputs)args.push("-i",input);
 const filter="[0:v]scale="+preset.width+":"+preset.height+":force_original_aspect_ratio=decrease,pad="+preset.width+":"+preset.height+":(ow-iw)/2:(oh-ih)/2,format=yuv420p[v]";
 return {command:"ffmpeg",args:[...args,"-filter_complex",filter,"-map","[v]",audioInputs.length?"-map":"-an",...(audioInputs.length?[""+(inputs.length)+":a:0","-c:a",preset.audioCodec]:[]),"-r",String(preset.fps),"-c:v",preset.videoCodec,output],preset,inputCount:inputs.length+audioInputs.length};
}

export function manifestToFfmpegPlan(manifest){
 const media=manifest.media??[];
 const audio=manifest.audio??[];
 return buildFfmpegPlan({media,audio,format:manifest.format,output:manifest.output??"output.mp4"});
}
