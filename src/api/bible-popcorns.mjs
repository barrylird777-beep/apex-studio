import express from "express";
import { db } from "../db/index.js";
import { bibleCollections, biblePassages } from "../db/schema.js";
import { and, eq, inArray } from "drizzle-orm";
import { enqueuePopcornPassages } from "../workers/popcorn-worker.mjs";
import { getPopcorn, listPopcorns } from "../core/bible/popcorn-store.mjs";

const router=express.Router();
router.get("/",async(req,res)=>{try{res.json({success:true,popcorns:await listPopcorns({collectionId:req.query.collectionId,q:req.query.q,limit:req.query.limit,offset:req.query.offset})})}catch(e){res.status(500).json({success:false,error:e.message})}});
router.get("/:id",async(req,res)=>{try{const x=await getPopcorn(req.params.id);if(!x)return res.status(404).json({success:false,error:"Popcorn not found"});res.json({success:true,popcorn:x})}catch(e){res.status(500).json({success:false,error:e.message})}});
router.post("/discover",async(req,res)=>{try{
  const collectionId=Number(req.body?.collectionId);const passageIds=Array.isArray(req.body?.passageIds)?req.body.passageIds.map(Number).filter(Number.isInteger):[];
  if(!passageIds.length)return res.status(400).json({success:false,error:"passageIds[] is required; Popcorn discovery only accepts canonical DB passages"});
  const rows=await db.select({id:biblePassages.id}).from(biblePassages).where(and(eq(biblePassages.collectionId,collectionId),inArray(biblePassages.id,passageIds)));
  if(rows.length!==passageIds.length)return res.status(409).json({success:false,error:"One or more passages are not in the selected Bible collection"});
  const ids=await enqueuePopcornPassages(passageIds);res.status(202).json({success:true,queued:ids.length,taskIds:ids});
}catch(e){res.status(503).json({success:false,error:e.message})}});
export default router;
