import path from 'node:path';
import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import { createQueue } from '../src/jobs/queue.mjs';
import { createOverseer } from '../src/jobs/overseer.mjs';
import { createSqliteStore, createSqliteLedger } from '../src/jobs/sqlite-store.mjs';
import { startStatusServer } from '../src/jobs/worker.mjs';

const dbPath=path.resolve(process.env.JOBS_DB_PATH??'data/jobs.db');
mkdirSync(path.dirname(dbPath),{recursive:true});
const db=new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

const queue=createQueue({store:createSqliteStore(db)});
const ledger=createSqliteLedger(db);
const log=(m)=>console.error(`[worker] ${m}`);
let handlers={};

if(process.env.GEMINI_API_KEY){
  try{
    const {createGemini}=await import('../src/video/gemini.mjs');
    const {createVideoHandlers}=await import('../src/jobs/video-handlers.mjs');
    handlers=createVideoHandlers({gemini:createGemini(),ledger,log,outRoot:path.resolve(process.env.OUT_ROOT??'out')});
  }catch(e){log(`video handlers unavailable: ${e.message}`);}
}
if(Object.keys(handlers).length===0){
  log('no job handlers registered (need GEMINI_API_KEY and src/video/*); refusing to start so jobs are not killed');
  process.exitCode=2;
  db.close();
  process.exit();
}

const overseer=createOverseer({queue,handlers,log,workerId:`worker-${process.pid}`,concurrency:Number(process.env.WORKER_CONCURRENCY??1)});
let server=null;
if(process.env.STATUS_TOKEN){
  server=await startStatusServer({queue,token:process.env.STATUS_TOKEN,port:Number(process.env.STATUS_PORT??8787)});
  log(`status server on 127.0.0.1:${server.address().port}`);
}else log('STATUS_TOKEN not set: status server disabled');

overseer.start();
log(`running (db ${dbPath}, handlers: ${Object.keys(handlers).join(', ')})`);

let stopping=false;
const shutdown=async()=>{
  if(stopping)return;
  stopping=true;log('shutting down');
  await overseer.stop();
  await new Promise(resolve=>server?server.close(resolve):resolve());
  db.close();
};
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
