import { createStudio } from "./studio.mjs";
import { createCharacter } from "../characters/dna.mjs";
export function bootstrap(){const studio=createStudio();studio.characters=new Map();studio.characters.create=input=>{const c=createCharacter(input);studio.characters.set(c.id,c);return c};studio.characters.list=()=>[...studio.characters.values()];return studio;}
