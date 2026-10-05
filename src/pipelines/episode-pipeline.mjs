import crypto from "node:crypto";

function bookName(book) {
  const value=String(book||"").trim();
  if(!/^\p{L}[\p{L}\p{N} .'-]{0,79}$/u.test(value)) throw new Error("Invalid Bible book name");
  return value;
}
function chapterNumber(chapter) {
  const value=Number(chapter);
  if(!Number.isInteger(value)||value<1||value>300) throw new Error("Invalid chapter");
  return value;
}
function verseRange(verses) {
  const value=String(verses||"full").trim();
  if(!/^(?:full|\d{1,3}(?:-\d{1,3})?)$/i.test(value)) throw new Error("Invalid verse range");
  return value;
}
export class EpisodePipeline {
  constructor(pool){if(!pool) throw new TypeError("EpisodePipeline requires PostgreSQL");this.pool=pool;}
  async igniteEpisode(book,chapter,verses="full",traceId=null){
    const b=bookName(book), c=chapterNumber(chapter), v=verseRange(verses), episodeId=crypto.randomUUID();
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      await client.query("INSERT INTO apex_episode_pipelines (id,book,chapter,verses) VALUES ($1,$2,$3,$4)",[episodeId,b,c,v]);
      const jobs=[
        ["graph-expansion",{episodeId,book:b,chapter:c,verses:v,type:"theological",stage:1,traceId}],
        ["graph-expansion",{episodeId,book:b,chapter:c,verses:v,type:"historical",stage:1}],
        ["episode-script-generation",{episodeId,book:b,chapter:c,verses:v,stage:2,dependsOnStage:1,traceId}]
      ];
      for(const [role,payload] of jobs){
        await client.query("INSERT INTO apex_worker_tasks (id,worker_id,role,task,payload,max_attempts,dedupe_key,trace_id) VALUES ($1,'episode-pipeline',$2,$3,$4::jsonb,5,$5,$6) ON CONFLICT DO NOTHING",[crypto.randomUUID(),role,role,JSON.stringify(payload),`episode:${episodeId}:${role}:${payload.type||"default"}`,traceId ? String(traceId).slice(0,255) : null]);
      }
      await client.query("COMMIT");
      return {episodeId,jobs:3};
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }
}
