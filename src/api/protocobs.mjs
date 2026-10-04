import express from "express";
import { db } from "../db/index.js";
import { protocobs, productionApprovals, projects } from "../db/schema.js";
import { and, desc, eq } from "drizzle-orm";

const r=express.Router();
const allowed=new Set(["pending","kept","rejected","modified"]);
r.get("/",async(req,res)=>{try{const f=[];if(req.query.projectId)f.push(eq(protocobs.projectId,Number(req.query.projectId)));if(req.query.status)f.push(eq(protocobs.status,String(req.query.status)));const rows=await db.select().from(protocobs).where(f.length?and(...f):undefined).orderBy(desc(protocobs.createdAt)).limit(500);res.json({success:true,protocobs:rows})}catch(e){res.status(500).json({success:false,error:e.message})}});
r.post("/",async(req,res)=>{try{const b=req.body||{},projectId=Number(b.projectId);if(!projectId||!String(b.title||"").trim()||!String(b.concept||"").trim())return res.status(400).json({success:false,error:"projectId, title and concept are required"});const p=await db.select({id:projects.id}).from(projects).where(eq(projects.id,projectId)).limit(1);if(!p[0])return res.status(404).json({success:false,error:"Project not found"});const x=(await db.insert(protocobs).values({projectId,sceneId:b.sceneId?Number(b.sceneId):null,title:String(b.title).trim(),concept:String(b.concept).trim(),prompt:b.prompt?String(b.prompt):null,visualDna:b.visualDna&&typeof b.visualDna==="object"?b.visualDna:{},artifactPath:b.artifactPath?String(b.artifactPath):null,status:"pending",createdBy:String(b.createdBy||"cob")}).returning())[0];res.status(201).json({success:true,protocob:x})}catch(e){res.status(400).json({success:false,error:e.message})}});
async function decide(req,res,status,action){try{const id=Number(req.params.id),note=req.body?.note?String(req.body.note):null,x=(await db.update(protocobs).set({status,updatedAt:new Date(),cornNuts:req.body?.cornNuts==null?undefined:Math.max(1,Math.min(5,Number(req.body.cornNuts))) }).where(eq(protocobs.id,id)).returning())[0];if(!x)return res.status(404).json({success:false,error:"Protocob not found"});await db.insert(productionApprovals).values({projectId:x.projectId,protocobId:x.id,action,note});res.json({success:true,protocob:x,approval:{action,note}})}catch(e){res.status(400).json({success:false,error:e.message})}}
r.post("/:id/approve",(q,s)=>decide(q,s,"kept","KEEP"));
r.post("/:id/reject",(q,s)=>decide(q,s,"rejected","REJECT"));
r.post("/:id/modify",(q,s)=>decide(q,s,"modified","MODIFY"));
r.get("/:id/history",async(req,res)=>{try{res.json({success:true,history:await db.select().from(productionApprovals).where(eq(productionApprovals.protocobId,Number(req.params.id))).orderBy(desc(productionApprovals.createdAt))})}catch(e){res.status(500).json({success:false,error:e.message})}});
export default r;
