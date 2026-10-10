import pg from "pg";
const { Pool } = pg;

export class EnterpriseDistributedStore {
  constructor(options={}) {
    this.connectionString=options.connectionString||process.env.DATABASE_URL;
    if(!this.connectionString) throw new Error("DATABASE_URL is required for distributed execution");
    this.pool=new Pool({
      connectionString:this.connectionString,
      max:Number(process.env.APEX_PG_POOL_SIZE||20),
      idleTimeoutMillis:Number(process.env.APEX_PG_IDLE_TIMEOUT_MS||30000),
      connectionTimeoutMillis:Number(process.env.APEX_PG_CONNECT_TIMEOUT_MS||10000),
      ssl:process.env.APEX_PG_SSL==="false"?false:{rejectUnauthorized:true}
    });
  }
  async connect(){await this.pool.query("SELECT 1");return this;}
  async initEnterpriseSchema(){
    await this.pool.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE TABLE IF NOT EXISTS production_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        type TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        priority INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        locked_at TIMESTAMPTZ,
        locked_by TEXT,
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ,
        heartbeat_at TIMESTAMPTZ,
        result JSONB,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS production_jobs_claim_idx
        ON production_jobs(status, available_at, priority DESC, created_at);
      CREATE INDEX IF NOT EXISTS production_jobs_lock_idx
        ON production_jobs(status, heartbeat_at);
      CREATE TABLE IF NOT EXISTS production_events (
        id BIGSERIAL PRIMARY KEY,
        job_id UUID REFERENCES production_jobs(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }
  async enqueueJob(type,payload={},priority=0){
    const {rows}=await this.pool.query(
      "INSERT INTO production_jobs(type,payload,priority) VALUES($1,$2,$3) RETURNING id",
      [type,payload,Number(priority)||0]
    );
    return rows[0].id;
  }
  async nextJobWorker(workerId=process.env.HOSTNAME||`worker-${process.pid}`){
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      const {rows}=await client.query(`
        SELECT * FROM production_jobs
        WHERE status='queued' AND available_at<=now()
        ORDER BY priority DESC, created_at ASC
        FOR UPDATE SKIP LOCKED LIMIT 1`);
      if(!rows.length){await client.query("COMMIT");return null;}
      const job=rows[0];
      await client.query(`
        UPDATE production_jobs
        SET status='running', attempts=attempts+1, locked_at=now(), locked_by=$1,
            started_at=COALESCE(started_at,now()), heartbeat_at=now(), updated_at=now()
        WHERE id=$2`,[workerId,job.id]);
      await client.query("INSERT INTO production_events(job_id,event_type,payload) VALUES($1,$2,$3)",[job.id,"claimed",{workerId}]);
      await client.query("COMMIT");
      return {...job,status:"running",attempts:job.attempts+1,locked_by:workerId};
    }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
  }
  async heartbeatJob(id,workerId){
    await this.pool.query("UPDATE production_jobs SET heartbeat_at=now(),updated_at=now() WHERE id=$1 AND status='running' AND locked_by=$2",[id,workerId]);
  }
  async completeJob(id,result={}){
    await this.pool.query("UPDATE production_jobs SET status='completed',finished_at=now(),heartbeat_at=now(),result=$2,updated_at=now() WHERE id=$1 AND status='running'",[id,result]);
    await this.pool.query("INSERT INTO production_events(job_id,event_type,payload) VALUES($1,$2,$3)",[id,"completed",result]);
  }
  async failJob(id,error,{retry=true,delaySeconds=10}={}){
    const message=String(error?.stack||error).slice(0,20000);
    await this.pool.query(`
      UPDATE production_jobs
      SET status=CASE WHEN $2 THEN 'queued' ELSE 'failed' END,
          available_at=CASE WHEN $2 THEN now()+make_interval(secs=>$3) ELSE available_at END,
          error=$4,updated_at=now()
      WHERE id=$1 AND status='running'`,[id,retry,delaySeconds,message]);
    await this.pool.query("INSERT INTO production_events(job_id,event_type,payload) VALUES($1,$2,$3)",[id,"failed",{message,retry}]);
  }
  async recoverStaleJobs(timeoutSeconds=300){
    const {rows}=await this.pool.query(`
      UPDATE production_jobs
      SET status='queued',locked_at=NULL,locked_by=NULL,available_at=now(),updated_at=now()
      WHERE status='running' AND heartbeat_at < now()-make_interval(secs=>$1)
      RETURNING id`,[timeoutSeconds]);
    return rows.map(r=>r.id);
  }
  async close(){await this.pool.end();}
}
