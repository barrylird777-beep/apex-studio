import path from "node:path";

export const OUTPUT_PRESETS=Object.freeze({
 master:{width:1920,height:1080,fps:30,videoCodec:"libx264",audioCodec:"aac"},
 "youtube-1080p":{width:1920,height:1080,fps:30,videoCodec:"libx264",audioCodec:"aac"},
 "vertical-1080x1920":{width:1080,height:1920,fps:30,videoCodec:"libx264",audioCodec:"aac"},
 square:{width:1080,height:1080,fps:30,videoCodec:"libx264",audioCodec:"aac"}
});

export function buildFfmpegPlan({media=[],audio=[],format="master",output="output.mp4"}={}){
 const preset=OUTPUT_PRESETS[format]??OUTPUT_PRESETS.master;
 const video=media.filter(m=>m?.uri&&m.type!=="audio");
 const audioInputs=audio.filter(a=>a?.uri);
 if(!video.length) return {command:"ffmpeg",args:["-y","-f","lavfi","-i","color=c=black:s="+preset.width+"x"+preset.height+":r="+preset.fps,"-t","1","-c:v",preset.videoCodec,output],preset,inputCount:1,ready:false,reason:"No visual media is attached yet."};
 const args=["-y"];
 for(const m of video)args.push("-i",path.resolve(m.uri));
 for(const a of audioInputs)args.push("-i",path.resolve(a.uri));
 const concat=video.map((_,i)=>"["+i+":v]scale="+preset.width+":"+preset.height+":force_original_aspect_ratio=decrease,pad="+preset.width+":"+preset.height+":(ow-iw)/2:(oh-ih)/2,setsar=1[v"+i+"]").join(";");
 const chain=video.map((_,i)=>"[v"+i+"]").join("")+"concat=n="+video.length+":v=1:a=0[v]";
 const filters=concat+";"+chain;
 const out=["-filter_complex",filters,"-map","[v]"];
 if(audioInputs.length)out.push("-map",video.length+":a:0","-c:a",preset.audioCodec);else out.push("-an");
 out.push("-r",String(preset.fps),"-c:v",preset.videoCodec,"-movflags","+faststart",output);
 return {command:"ffmpeg",args:[...args,...out],preset,inputCount:video.length+audioInputs.length,ready:true};
}
