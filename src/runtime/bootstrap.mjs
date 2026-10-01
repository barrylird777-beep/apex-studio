import { createStudio } from "./studio.mjs";
import { createCharacter } from "../characters/dna.mjs";
export function bootstrap(){const studio=createStudio({layersPasscode:process.env.APEX_LAYERS_PASSCODE});const characters=new Map();studio.characters={create(input){const c=createCharacter(input);characters.set(c.id,c);return c},get(id){return characters.get(id)??null},list(){return [...characters.values()]}};return studio;}
