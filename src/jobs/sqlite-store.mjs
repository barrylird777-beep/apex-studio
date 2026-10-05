export const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('queued','running','done','dead')),
  run_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL,
  lease_token TEXT,
  lease_expires_at INTEGER,
  worker_id TEXT,
  last_error TEXT,
  result TEXT,
  dedupe_key TEXT,
  recovered_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs (run_at, created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS jobs_lease_idx ON jobs (lease_expires_at) WHERE status = 'running';
CREATE UNIQUE INDEX IF NOT EXISTS jobs_dedupe_idx ON jobs (dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('queued','running');
CREATE TABLE IF NOT EXISTS job_workers (
  id TEXT PRIMARY KEY,
  last_seen INTEGER NOT NULL,
  info TEXT NOT NULL DEFAULT '{}'
);
`;

const parse = (s) => (s === null || s === undefined ? null : JSON.parse(s));
const row = (r) => r && ({
  id:r.id,type:r.type,payload:parse(r.payload),status:r.status,runAt:r.run_at,
  attempts:r.attempts,maxAttempts:r.max_attempts,leaseToken:r.lease_token,
  leaseExpiresAt:r.lease_expires_at,workerId:r.worker_id,lastError:r.last_error,
  result:parse(r.result),dedupeKey:r.dedupe_key,recoveredCount:r.recovered_count,
  createdAt:r.created_at,updatedAt:r.updated_at,
});

export function createSqliteStore(db) {
  if (!db?.prepare || !db?.exec || !db?.transaction) throw new Error('createSqliteStore requires a better-sqlite3 Database');
  db.exec(SQLITE_SCHEMA);
  const get=(sql,...p)=>row(db.prepare(sql).get(...p));
  const all=(sql,...p)=>db.prepare(sql).all(...p).map(row);
  const changed=(sql,params)=>db.prepare(sql).run(params).changes===1;

  const enqueueTx=db.transaction((a)=>{
    if(a.dedupeKey){
      const live=get("SELECT * FROM jobs WHERE dedupe_key=? AND status IN ('queued','running') LIMIT 1",a.dedupeKey);
      if(live)return live;
    }
    db.prepare(`INSERT INTO jobs
      (id,type,payload,status,run_at,max_attempts,dedupe_key,created_at,updated_at)
      VALUES (@id,@type,@payload,'queued',@runAt,@maxAttempts,@dedupeKey,@now,@now)`)
      .run({id:a.id,type:a.type,payload:JSON.stringify(a.payload),runAt:a.runAt,
        maxAttempts:a.maxAttempts,dedupeKey:a.dedupeKey??null,now:a.now});
    return get("SELECT * FROM jobs WHERE id=?",a.id);
  });

  const claimTx=db.transaction((a)=>{
    const next=db.prepare("SELECT id FROM jobs WHERE status='queued' AND run_at<=? ORDER BY run_at,created_at,rowid LIMIT 1").get(a.now);
    if(!next)return null;
    const leaseToken = typeof a.token === 'function' ? a.token() : a.token;
    db.prepare(`UPDATE jobs SET status='running',lease_token=@token,lease_expires_at=@exp,
      worker_id=@workerId,attempts=attempts+1,updated_at=@now WHERE id=@id`)
      .run({token:leaseToken,exp:a.now+a.leaseMs,workerId:a.workerId,now:a.now,id:next.id});
    return get("SELECT * FROM jobs WHERE id=?",next.id);
  });

  return {
    async enqueue(a){return enqueueTx.immediate(a);},
    async claimOne(a){return claimTx.immediate(a);},
    async heartbeat({id,token,now,leaseMs}){return changed(
      "UPDATE jobs SET lease_expires_at=@exp,updated_at=@now WHERE id=@id AND status='running' AND lease_token=@token",
      {exp:now+leaseMs,now,id,token});},
    async complete({id,token,result,now}){return changed(
      "UPDATE jobs SET status='done',result=@result,lease_token=NULL,lease_expires_at=NULL,updated_at=@now WHERE id=@id AND status='running' AND lease_token=@token",
      {result:JSON.stringify(result??null),now,id,token});},
    async fail({id,token,error,now,retryAt}){return changed(
      `UPDATE jobs SET status=CASE WHEN @retryAt IS NULL THEN 'dead' ELSE 'queued' END,
       run_at=COALESCE(@retryAt,run_at),last_error=@error,lease_token=NULL,lease_expires_at=NULL,updated_at=@now
       WHERE id=@id AND status='running' AND lease_token=@token`,
      {retryAt:retryAt??null,error,now,id,token});},
    async listExpired({now}){return all("SELECT * FROM jobs WHERE status='running' AND lease_expires_at < ?",now);},
    async requeueExpired({id,token,dead,now,runAt,error}){return changed(
      "UPDATE jobs SET status=CASE WHEN @dead=1 THEN 'dead' ELSE 'queued' END,run_at=@runAt,last_error=@error,lease_token=NULL,lease_expires_at=NULL,recovered_count=recovered_count+1,updated_at=@now WHERE id=@id AND status='running' AND lease_token=@token AND lease_expires_at<@now",
      {dead:dead?1:0,runAt,error,now,id,token});},
    async touchWorker({id,now,info}){db.prepare(`INSERT INTO job_workers(id,last_seen,info) VALUES(@id,@now,@info)
      ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen,info=excluded.info`).run({id,now,info:JSON.stringify(info??{})});},
    async listWorkers(){return db.prepare("SELECT id,last_seen,info FROM job_workers ORDER BY id").all().map(r=>({id:r.id,lastSeen:r.last_seen,info:parse(r.info)}));},
    async counts(){const c={queued:0,running:0,done:0,dead:0};for(const r of db.prepare("SELECT status,count(*) AS n FROM jobs GROUP BY status").all())c[r.status]=r.n;return c;},
    async listByStatus(status,limit=50){return all("SELECT * FROM jobs WHERE status=? ORDER BY updated_at DESC LIMIT ?",status,limit);},
    async listRetrying(limit=50){return all("SELECT * FROM jobs WHERE status='queued' AND attempts>0 ORDER BY run_at LIMIT ?",limit);},
    async listRecovered(limit=50){return all("SELECT * FROM jobs WHERE recovered_count>0 ORDER BY updated_at DESC LIMIT ?",limit);},
  };
}

export function createSqliteLedger(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS provenance(id INTEGER PRIMARY KEY AUTOINCREMENT,ts TEXT NOT NULL,entry TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS provenance_no_update BEFORE UPDATE ON provenance
      BEGIN SELECT RAISE(ABORT,'provenance is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS provenance_no_delete BEFORE DELETE ON provenance
      BEGIN SELECT RAISE(ABORT,'provenance is append-only'); END;
  `);
  const ins=db.prepare("INSERT INTO provenance(ts,entry) VALUES(?,?)");
  const sel=db.prepare("SELECT ts,entry FROM provenance ORDER BY id");
  return {
    async record(entry){ins.run(new Date().toISOString(),JSON.stringify(entry));},
    async read(){return sel.all().map(r=>({ts:r.ts,...JSON.parse(r.entry)}));},
  };
}
