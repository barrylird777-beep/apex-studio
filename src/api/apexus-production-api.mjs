import express from "express";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { episodeCode } from "../core/apexus-production.mjs";

const { Pool } = pg;

function buildPool() {
  if (!process.env.DATABASE_URL) return null;
  const url=process.env.DATABASE_URL;
  let host="";
  try{host=new URL(url).hostname}catch{}
  const local=host==="localhost"||host==="127.0.0.1"||host==="::1";
  return new Pool({
    connectionString:url,
    max:2,
    connectionTimeoutMillis:5000,
    ssl:process.env.APEX_PG_SSL==="false"||local?false:{rejectUnauthorized:false}
  });
}

export function createApexusProductionRouter({ enqueue, requireAuth } = {}) {
  if (typeof enqueue !== "function") throw new TypeError("Apexus production enqueue function is required");
  const router=express.Router();

  router.get("/status", async (_req,res)=>{
    const pool=buildPool();
    if(!pool) return res.status(503).json({success:false,error:"Apexus production database is not configured"});
    try{
      const [summary,queued,running]=await Promise.all([
        pool.query("SELECT state,COUNT(*)::int AS count FROM apexus_episodes GROUP BY state ORDER BY state"),
        pool.query("SELECT COUNT(*)::int AS count FROM durable_jobs WHERE type LIKE 'apexus.episode.%' AND status='queued'"),
        pool.query("SELECT COUNT(*)::int AS count FROM durable_jobs WHERE type LIKE 'apexus.episode.%' AND status='running'")
      ]);
      return res.json({
        success:true,
        network:"Apexus",
        episodeStates:summary.rows,
        queuedJobs:queued.rows[0]?.count||0,
        runningJobs:running.rows[0]?.count||0,
        checkedAt:new Date().toISOString()
      });
    }catch(error){
      return res.status(503).json({success:false,error:String(error?.message||error)});
    }finally{await pool.end();}
  });

  router.post("/start", requireAuth || ((_req,_res,next)=>next()), async (req,res)=>{
    const n=Number(req.body?.episodeNumber||1);
    try{
      const code=episodeCode(n);
      const pool=buildPool();
      if(!pool) return res.status(503).json({success:false,error:"Apexus production database is not configured"});
      try{
        const row=await pool.query("SELECT id,episode_code,state FROM apexus_episodes WHERE global_episode_number=$1",[n]);
        if(!row.rowCount) return res.status(404).json({success:false,error:"Apexus episode not found"});
        const episode=row.rows[0];
        const existing=await pool.query("SELECT id,status FROM durable_jobs WHERE dedupe_key=$1 ORDER BY created_at DESC LIMIT 1",[`apexus:${code}:story`]);
        if(existing.rowCount && ["queued","running"].includes(existing.rows[0].status)){
          return res.status(200).json({success:true,episodeCode:code,status:"already-queued",jobId:existing.rows[0].id});
        }
        const job=await enqueue({
          id:randomUUID(),
          workerId:"apexus-production-api",
          role:"apexus",
          task:"apexus.episode.story",
          payload:{episodeId:episode.id,episodeCode:episode.episode_code,stage:"story"},
          maxAttempts:8,
          dedupeKey:`apexus:${code}:story`,
          traceId:episode.id
        });
        return res.status(202).json({success:true,episodeCode:code,status:"queued",jobId:job.id});
      }finally{await pool.end();}
    }catch(error){
      return res.status(400).json({success:false,error:String(error?.message||error)});
    }
  });

  return router;
}
