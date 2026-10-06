import http from "node:http";import {createReadStream,existsSync} from "node:fs";import {extname,join} from "node:path";import {fileURLToPath} from "node:url";import {spawn} from "node:child_process";import {createProject,deleteProject,getProjectOverview,listProjects,updateProject} from "./projects";import {createCharacter,deleteCharacter,getCharacter,listCharacters,updateCharacter} from "./characters";import {listScenes,createScene,updateScene,deleteScene} from "./scenes";// @ts-ignore JavaScript pipeline modules are runtime-tested by Node.
import {generateBreakdown,BreakdownError} from "../scripture/breakdown.js";
import {getCalendar,createShootDay,deleteShootDay,assignScenes,reorderDay,unassignScene,runAutoSchedule} from "./schedule";
// @ts-ignore JavaScript provider adapter is runtime-loaded.
import {generateWithGemini} from "../ai/gemini.js";
// @ts-ignore JavaScript asset-stream module is runtime-tested by Node.
import {streamAsset} from "./asset-stream.mjs";