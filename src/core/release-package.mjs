import { uid, now } from "./id.mjs";

export function createReleasePackage(input={}){
 const title=String(input.title??"").trim();if(!title)throw new TypeError("title is required");
 return {id:input.id??uid("release"),title,description:input.description??"",platforms:[...(input.platforms??["youtube"])],tags:[...(input.tags??[])],chapters:[...(input.chapters??[])],scriptureRefs:[...(input.scriptureRefs??[])],subtitleMediaId:input.subtitleMediaId??null,videoMediaId:input.videoMediaId??null,thumbnail:{...(input.thumbnail??{})},channel:{...(input.channel??{})},disclosure:input.disclosure??"AI-assisted production where applicable; Scripture references are provided for verification.",status:input.status??"draft",createdAt:input.createdAt??now(),updatedAt:now()};
}
export function buildYouTubeDescription(pkg){
 const refs=pkg.scriptureRefs?.length?"\n\nScripture references:\n"+pkg.scriptureRefs.map(x=>"- "+x).join("\n"):"";
 const chapters=pkg.chapters?.length?"\n\nChapters:\n"+pkg.chapters.map(x=>`${x.time} ${x.title}`).join("\n"):"";
 return [pkg.description,chapters,refs,pkg.disclosure].filter(Boolean).join("\n");
}
export function buildSubtitleCues(narration=[]){
 let t=0;return narration.filter(x=>x.text).map(x=>{const cue={start:t,end:t+(x.duration??3),text:x.text};t=cue.end;return cue;});
}
