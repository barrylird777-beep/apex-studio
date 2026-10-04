#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { verifyMigrations } from './verifyMigrations.js';
const arg=(name,fallback)=>{const i=process.argv.indexOf(`--${name}`);return i>-1?process.argv[i+1]:fallback};
const dir=arg('dir','drizzle'),ef=arg('expect');
const expectations=ef?JSON.parse(readFileSync(ef,'utf8')):{};
const result=verifyMigrations({dir,expectations});
if(result.ok) console.log(`OK: ${result.migrationCount} migration(s) rebuild the expected schema from empty SQLite.`);
else { console.error('FAILED: committed migrations do not reproduce the expected schema:'); for(const e of result.errors) console.error(`  - ${e}`); process.exit(1); }
