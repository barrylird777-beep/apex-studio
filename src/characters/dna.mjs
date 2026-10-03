import { uid, now } from "../core/id.mjs";

const array=(v)=>Array.isArray(v)?v.map(x=>String(x).trim()).filter(Boolean):[];
export function createCharacter(input={}){
  const canonicalName=String(input.canonicalName??input.name??"").trim();
  if(!canonicalName) throw new TypeError("canonicalName is required");
  const createdAt=input.createdAt??now();
  return {
    id:input.id??uid("char"),
    canonicalName,
    name:canonicalName,
    aliases:array(input.aliases),
    primaryStories:array(input.primaryStories),
    relationships:array(input.relationships),
    keyTraits:array(input.keyTraits??input.traits),
    notes:String(input.notes??"").trim(),
    scriptureReferences:array(input.scriptureReferences??input.sourceRefs),
    linkedSceneIds:array(input.linkedSceneIds),
    identity:{...input.identity},
    appearance:{...input.appearance},
    personality:{...input.personality},
    motivations:array(input.motivations),
    arc:Array.isArray(input.arc)?input.arc:[],
    versions:Array.isArray(input.versions)?input.versions:[],
    visualRealism:{...(input.visualRealism??{})},
    createdAt,
    updatedAt:now()
  };
}
export function snapshotCharacter(character,label="revision"){const snap=structuredClone(character);snap.id=uid("cdna");snap.label=label;snap.snapshotAt=now();return snap;}
