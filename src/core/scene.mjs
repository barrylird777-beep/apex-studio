import { uid, now } from "./id.mjs";

export function createScene(input={}){
  return {
    id:input.id??uid("scene"),
    title:input.title??"Untitled Scene",
    projectId:input.projectId??null,
    storyId:input.storyId??null,
    storyEventId:input.storyEventId??null,
    timelineId:input.timelineId??null,
    locationId:input.locationId??null,
    characters:[...(input.characters??[])],
    beats:[...(input.beats??[])],
    dialogue:[...(input.dialogue??[])],
    shots:[...(input.shots??[])],
    continuityRefs:[...(input.continuityRefs??[])],
    sourceRefs:[...(input.sourceRefs??[])],
    notes:input.notes??"",
    status:input.status??"draft",
    createdAt:input.createdAt??now(),
    updatedAt:now()
  };
}

export function createShot(input={}){
  return {
    id:input.id??uid("shot"),
    sceneId:input.sceneId??null,
    index:Number.isFinite(input.index)?input.index:0,
    type:input.type??"wide",
    camera:input.camera??{},
    visual:input.visual??{},
    audio:input.audio??{},
    duration:Number.isFinite(input.duration)?input.duration:0,
    assetIds:[...(input.assetIds??[])],
    createdAt:input.createdAt??now()
  };
}
