import { uid, now } from "./id.mjs";

function clean(v){return String(v??"").trim();}
export function createCharacterBible(input={}){
 const name=clean(input.name);if(!name)throw new TypeError("character name is required");
 return {id:input.id??uid("char"),name,description:clean(input.description),appearance:{...(input.appearance??{})},wardrobe:{...(input.wardrobe??{})},age:input.age??null,traits:[...(input.traits??[])],doNotChange:[...(input.doNotChange??[])],referenceMediaIds:[...(input.referenceMediaIds??[])],sourceRefs:[...(input.sourceRefs??[])],createdAt:input.createdAt??now(),updatedAt:now()};
}
export function createLocationBible(input={}){
 const name=clean(input.name);if(!name)throw new TypeError("location name is required");
 return {id:input.id??uid("loc"),name,description:clean(input.description),environment:{...(input.environment??{})},architecture:{...(input.architecture??{})},lighting:{...(input.lighting??{})},weather:{...(input.weather??{})},referenceMediaIds:[...(input.referenceMediaIds??[])],sourceRefs:[...(input.sourceRefs??[])],createdAt:input.createdAt??now(),updatedAt:now()};
}
export class VisualBible{
 constructor(){this.characters=new Map();this.locations=new Map();}
 createCharacter(i){const x=createCharacterBible(i);this.characters.set(x.id,x);return x;}
 createLocation(i){const x=createLocationBible(i);this.locations.set(x.id,x);return x;}
 getCharacter(id){return this.characters.get(id)??null;}
 getLocation(id){return this.locations.get(id)??null;}
 listCharacters(){return [...this.characters.values()];}
 listLocations(){return [...this.locations.values()];}
 snapshot(){return {characters:this.listCharacters(),locations:this.listLocations()};}
 restore(s={}){this.characters.clear();this.locations.clear();for(const x of s.characters??[])this.characters.set(x.id,x);for(const x of s.locations??[])this.locations.set(x.id,x);return this;}
}