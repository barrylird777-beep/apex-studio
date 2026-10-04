#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const dir=process.argv[process.argv.indexOf("--dir")+1]||"drizzle-pg";
const expectPath=process.argv[process.argv.indexOf("--expect")+1];
const journal=join(dir,"meta","_journal.json");
const errors=[];
if(!existsSync(journal))errors.push("missing "+journal);
let entries=[];
if(!errors.length){entries=JSON.parse(readFileSync(journal,"utf8")).entries||[];for(const e of entries)if(!existsSync(join(dir,e.tag+".sql")))errors.push("missing migration "+e.tag+".sql")}
const sql=entries.map(e=>readFileSync(join(dir,e.tag+".sql"),"utf8")).join("\n").toLowerCase();
if(/sqlite|better-sqlite|sqlite_master|pragma\s/.test(sql))errors.push("PostgreSQL migrations contain SQLite-specific SQL");
if(expectPath&&existsSync(expectPath)){const x=JSON.parse(readFileSync(expectPath,"utf8"));for(const table of x.tables||[])if(!sql.includes('create table if not exists "'+table.toLowerCase()+'"'))errors.push("missing table "+table);for(const i of x.unique||[])if(!sql.includes(i.columns.map(c=>'"'+c.toLowerCase()+'"').join(",")))errors.push("missing unique/index columns "+i.table+"("+i.columns.join(",")+")")}
if(errors.length){console.error("FAILED:",...errors.map(x=>"\n - "+x));process.exit(1)}
console.log("OK: PostgreSQL migration journal and SQL checks passed:",entries.length,"migration(s)");
