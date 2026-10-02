import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
const ALLOWED=new Set([".mp4",".mov",".webm",".mkv",".mp3",".wav",".m4a",".png",".jpg",".jpeg",".webp",".json",".txt"]);
const maxBytes=()=>Number(process.env.APEX_MAX_UPLOAD_MB||2048)*1024*1024;
const dir=()=>path.resolve(process.env.APEX_UPLOAD_DIR||"./uploads");
export async function uploadRoute(req,res) {
  const name=path.basename(String(req.params.name||"")).replace(/[^\w.-]/g,"_").replace(/^\.+/,"");
  const ext=path.extname(name).toLowerCase();
  if(!name||!ALLOWED.has(ext)) return res.status(400).json({error:"File type not allowed"});
  const declared=Number(req.headers["content-length"]||0);
  if(declared>maxBytes()) return res.status(413).json({error:"File too large"});
  fs.mkdirSync(dir(),{recursive:true,mode:0o700});
  const file=`${crypto.randomBytes(6).toString("hex")}_${name}`;
  const target=path.join(dir(),file);
  let size=0;
  const cap=new Transform({transform(chunk,_e,cb){size+=chunk.length;size>maxBytes()?cb(new Error("too large")):cb(null,chunk);}});
  try {
    await pipeline(req,cap,fs.createWriteStream(target,{mode:0o600,flags:"wx"}));
    res.json({ok:true,file,bytes:size});
  } catch {
    fs.rm(target,{force:true},()=>{});
    if(!res.headersSent) res.status(413).json({error:"Upload failed or too large"});
  }
}