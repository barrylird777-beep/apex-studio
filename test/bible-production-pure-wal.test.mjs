import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import vm from "node:vm";
import crypto from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import sqlite3Module from "sqlite3";

const sqlite3=sqlite3Module.default||sqlite3Module;
const run=(db,sql,params=[])=>new Promise((resolve,reject)=>db.run(sql,params,function(error){error?reject(error):resolve({id:this.lastID,changes:this.changes});}));
const exec=(db,sql)=>new Promise((resolve,reject)=>db.exec(sql,error=>error?reject(error):resolve()));
const close=db=>new Promise(resolve=>db.close(()=>resolve()));
const digest=buffer=>crypto.createHash("sha256").update(buffer).digest("hex");

test("Bible Production Desk imports legacy SQLite read-only and serves CRUD from Pure-WAL",async()=>{
  const root=await mkdtemp(path.join(tmpdir(),"kernelvision-bible-pure-wal-"));
  const legacyDb=path.join(root,"legacy.sqlite");
  const projectsDir=path.join(root,"projects");
  const walDir=path.join(root,"wal");
  const oldEnv={APEX_PROJECTS_DIR:process.env.APEX_PROJECTS_DIR,APEX_SOVEREIGN_STORAGE_DIR:process.env.APEX_SOVEREIGN_STORAGE_DIR,APEX_BIBLE_DB:process.env.APEX_BIBLE_DB,APEX_BIBLE_DB_DIR:process.env.APEX_BIBLE_DB_DIR};
  let server;
  try{
    const db=new sqlite3.Database(legacyDb);
    await exec(db,`
      CREATE TABLE projects(id INTEGER PRIMARY KEY,title TEXT,description TEXT,primary_scripture TEXT,status TEXT,created_at TEXT,updated_at TEXT);
      CREATE TABLE characters(id INTEGER PRIMARY KEY,canonical_name TEXT,aliases TEXT,primary_stories TEXT,relationships TEXT,key_traits TEXT,notes TEXT,scripture_references TEXT);
      CREATE TABLE scenes(id INTEGER PRIMARY KEY,project_id INTEGER,scene_number INTEGER,title TEXT,scripture_ref TEXT,location TEXT,characters_present TEXT,action_summary TEXT,emotional_beat TEXT,production_notes TEXT,estimated_pages REAL,day_or_night TEXT);
    `);
    await run(db,"INSERT INTO projects VALUES(7,?,?,?,?,?,?)",["Legacy Exodus Project","Preserved test project","Exodus 14:21-31","development","2026-10-01T00:00:00.000Z","2026-10-02T00:00:00.000Z"]);
    await run(db,"INSERT INTO characters VALUES(12,?,?,?,?,?,?,?)",["Moses",'["Moshe"]','["Exodus"]','[]','["Leader"]',"Legacy notes",'["Exodus 14:21-31"]']);
    await run(db,"INSERT INTO scenes VALUES(31,7,1,?,?,?,?,?,?,?,?,?)",["The Sea Opens","Exodus 14:21-31","Red Sea","[12]","The waters part.","Awe and fear.","Keep the geography consistent.",2,"Night"]);
    await close(db);
    const originalHash=digest(await readFile(legacyDb));

    process.env.APEX_PROJECTS_DIR=projectsDir;
    process.env.APEX_SOVEREIGN_STORAGE_DIR=walDir;
    process.env.APEX_BIBLE_DB=legacyDb;
    delete process.env.APEX_BIBLE_DB_DIR;

    const {default:router}=await import("../src/api/bible-production.mjs?purewal-test="+crypto.randomUUID());
    const app=express();app.use(express.json({limit:"1mb"}));app.use("/api/bible-production",router);
    server=createServer(app);await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
    const origin="http://127.0.0.1:"+server.address().port;
    const request=async(pathname,options={})=>{
      const response=await fetch(origin+"/api/bible-production"+pathname,{...options,headers:{"content-type":"application/json",...(options.headers||{})}});
      const type=response.headers.get("content-type")||"";
      return {response,body:type.includes("application/json")?await response.json():Buffer.from(await response.arrayBuffer())};
    };

    const status=await request("/status");
    assert.equal(status.response.status,200);
    assert.equal(status.body.storage,"local-pure-wal");
    assert.equal(status.body.databaseDependency,false);
    assert.equal(status.body.migration.status,"completed");

    const projects=await request("/projects");
    assert.equal(projects.response.status,200);
    assert.ok(projects.body.some(project=>String(project.id)==="7"&&project.title==="Legacy Exodus Project"));

    const characters=await request("/characters?q=Moses");
    assert.ok(characters.body.some(character=>String(character.id)==="12"&&character.canonicalName==="Moses"&&character.aliases.includes("Moshe")));

    const generated=await request("/scenes/generate",{method:"POST",body:JSON.stringify({projectId:"7",scriptureReference:"Exodus 14:21-31",text:"Moses raised his staff. The sea divided and the people crossed. The waters returned after the people reached safety."})});
    assert.equal(generated.response.status,200);
    assert.ok(Array.isArray(generated.body));
    assert.equal(generated.body.length,3);
    assert.equal(generated.body[0].id,"");

    const saved=await request("/scenes",{method:"POST",body:JSON.stringify({projectId:"7",sceneNumber:2,scriptureReference:"Exodus 14:21-31",location:"Red Sea",characters:["Moses"],actionSummary:"The people cross safely.",emotionalBeat:"Hope replaces fear.",productionNotes:"Keep the water-wall continuity."})});
    assert.equal(saved.response.status,201);
    assert.ok(saved.body.id);
    const sceneList=await request("/scenes?projectId=7");
    assert.ok(sceneList.body.some(scene=>scene.id===saved.body.id&&scene.actionSummary==="The people cross safely."));

    const call=await request("/call-sheets/from-scenes",{method:"POST",body:JSON.stringify({projectId:"7",sceneIds:[saved.body.id],shootDate:"2026-10-12",weatherNotes:"Clear",specialRequirements:"Continuity review"})});
    assert.equal(call.response.status,201);
    assert.deepEqual(call.body.sceneIds,[saved.body.id]);
    const pdf=await request("/call-sheets/"+encodeURIComponent(call.body.id)+"/pdf");
    assert.equal(pdf.response.status,200);
    assert.match(pdf.response.headers.get("content-type"),/application\/pdf/);
    assert.ok(pdf.body.subarray(0,8).toString().startsWith("%PDF-1.4"));

    assert.equal(digest(await readFile(legacyDb)),originalHash,"legacy SQLite file must remain byte-for-byte unchanged");
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    for(const [key,value] of Object.entries(oldEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    await rm(root,{recursive:true,force:true});
  }
});


test("KernelVision production pages contain syntactically valid inline JavaScript",async()=>{
  for(const filename of ["public/index.html","public/production.html","public/rapid-video.html"]){
    const html=await readFile(new URL("../"+filename,import.meta.url),"utf8");
    const scripts=[...html.matchAll(/<script\\b[^>]*>([\\s\\S]*?)<\\/script>/gi)].map(match=>match[1]).filter(script=>script.trim());
    assert.ok(scripts.length>0,filename+" should contain its expected application script");
    scripts.forEach((script,index)=>new vm.Script(script,{filename:filename+"#script-"+index}));
  }
  const production=await readFile(new URL("../public/production.html",import.meta.url),"utf8");
  assert.doesNotMatch(production,/onclick="fill(?:Scene|Call)\\(/,"production list cards must not interpolate JSON into inline handlers");
});
