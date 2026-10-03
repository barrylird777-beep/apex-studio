import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";
const sqlite = new Database("apex.db");
sqlite.pragma("foreign_keys = ON");
export const db = drizzle(sqlite,{schema});
export { sqlite };