import pg from "pg";

const { Pool } = pg;
let pool;

function enabled() { return Boolean(String(process.env.DATABASE_URL || "").trim()); }
function db() {
  if (!enabled()) return null;
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Math.max(5, Math.min(10, Number(process.env.APEX_WORKER_DB_POOL_MAX || 8))) });
  return pool;
}
const json = value => JSON.stringify(value ?? {});
const owner = () => process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local";

export async function registerDurableAgent(agent) {
  if (!enabled()) return { durable:false, agent };
  const r = await db().query(`INSERT INTO apex_agents
    (id,role,status,capabilities,tools,permissions,metadata,max_concurrency,last_heartbeat_at)
    VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,NOW())
    ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role,status=EXCLUDED.status,
      capabilities=EXCLUDED.capabilities,tools=EXCLUDED.tools,permissions=EXCLUDED.permissions,
      metadata=EXCLUDED.metadata,max_concurrency=EXCLUDED.max_concurrency,last_heartbeat_at=NOW(),updated_at=NOW()
    RETURNING *`, [agent.id,agent.role||"general",agent.status||"ready",json(agent.capabilities),json(agent.tools),json(agent.permissions),json(agent.metadata),Math.max(1,Number(agent.maxConcurrency)||1)]);
  return { durable:true, agent:r.rows[0] };
}

export async function heartbeatDurableAgent(agentId, status="ready") {
  if (!enabled()) return false;
  const r=await db().query(`UPDATE apex_agents SET status=$2,last_heartbeat_at=NOW(),updated_at=NOW()
    WHERE id=$1 AND status <> 'retired'`,[agentId,status]);
  return r.rowCount===1;
}

export async function setDurableAgentFailure(agentId, quarantineAt=3) {
  if (!enabled()) return false;
  const r=await db().query(`UPDATE apex_agents SET
    failure_count=failure_count+1,
    status=CASE WHEN failure_count+1 >= $2 THEN 'quarantined' ELSE 'degraded' END,
    updated_at=NOW()
    WHERE id=$1 AND status <> 'retired' RETURNING status,failure_count`,[agentId,quarantineAt]);
  return r.rows[0]||null;
}

export async function reviveDurableAgent(agentId) {
  if (!enabled()) return false;
  const r=await db().query(`UPDATE apex_agents SET status='ready',failure_count=0,updated_at=NOW()
    WHERE id=$1 AND status IN ('degraded','quarantined') RETURNING id`,[agentId]);
  return r.rowCount===1;
}

export async function createDurablePlan({id,goal,graph,context={}}) {
  if (!enabled()) return { durable:false,id };
  const r=await db().query(`INSERT INTO apex_execution_plans(id,goal,graph,context)
    VALUES($1,$2,$3::jsonb,$4::jsonb) RETURNING *`,[id,goal,json(graph),json(context)]);
  return { durable:true,plan:r.rows[0] };
}

export async function materializePlanNodes(planId,nodes) {
  if (!enabled()) return { durable:false,count:nodes.length };
  const client=await db().connect();
  try {
    await client.query("BEGIN");
    for (const n of nodes) await client.query(`INSERT INTO apex_execution_nodes
      (id,plan_id,name,capability,depends_on,max_attempts,input,metadata)
      VALUES($1,$2,$3,$4,$5::uuid[],$6,$7::jsonb,$8::jsonb)
      ON CONFLICT(plan_id,name) DO NOTHING`,
      [n.id,planId,n.name,n.capability,n.dependsOn||[],n.maxAttempts||3,json(n.input),json(n.metadata)]);
    await client.query("COMMIT");
    return {durable:true,count:nodes.length};
  } catch(e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}

export async function appendAgentEvent({agentId=null,planId=null,nodeId=null,eventType,payload={}}) {
  if (!enabled()) return false;
  await db().query(`INSERT INTO apex_agent_events(agent_id,plan_id,node_id,event_type,payload)
    VALUES($1,$2,$3,$4,$5::jsonb)`,[agentId,planId,nodeId,eventType,json(payload)]);
  return true;
}

export async function claimReadyExecutionNodes(limit=20) {
  if (!enabled()) return [];
  const r=await db().query(`WITH ready AS (
    SELECT n.id FROM apex_execution_nodes n
    WHERE n.status='pending'
      AND NOT EXISTS (
        SELECT 1 FROM apex_execution_nodes d
        WHERE d.id=ANY(n.depends_on) AND d.status <> 'completed'
      )
    ORDER BY n.created_at
    FOR UPDATE SKIP LOCKED LIMIT $1
  ) UPDATE apex_execution_nodes n SET status='queued',updated_at=NOW()
    FROM ready WHERE n.id=ready.id RETURNING n.*`,[Math.max(1,Math.min(100,Number(limit)||20))]);
  return r.rows;
}

export async function bindExecutionNodeLease(nodeId, workerTaskId, leaseToken) {
  if (!enabled()) return false;
  const r = await db().query(
    `UPDATE apex_execution_nodes
     SET worker_lease_token=$3, updated_at=NOW()
     WHERE id=$1 AND worker_task_id=$2 AND status='queued' AND worker_lease_token IS NULL`,
    [nodeId, workerTaskId, leaseToken]
  );
  return r.rowCount===1;
}

export async function updateExecutionNodeForLease(id, workerTaskId, leaseToken, patch={}) {
  if (!enabled()) return false;
  const allowed = new Set(["status","result","verification","last_error"]);
  const fields=[]; const values=[id,workerTaskId,leaseToken]; let i=4;
  for (const [key,value] of Object.entries(patch)) {
    if (!allowed.has(key)) continue;
    fields.push(key+"=$"+i+(["result","verification"].includes(key)?"::jsonb":""));
    values.push(["result","verification"].includes(key)?json(value):value); i++;
  }
  if (!fields.length) return false;
  fields.push("updated_at=NOW()");
  const r=await db().query(
    "UPDATE apex_execution_nodes SET "+fields.join(",")+" WHERE id=$1 AND worker_task_id=$2 AND worker_lease_token=$3",
    values
  );
  return r.rowCount===1;
}

export async function updateExecutionNode(id, patch={}) {
  if (!enabled()) return false;
  const fields=[]; const values=[id]; let i=2;
  for (const [key,value] of Object.entries(patch)) {
    if (!["status","worker_task_id","worker_lease_token","result","verification","last_error"].includes(key)) continue;
    fields.push(key+"=$"+i+(["result","verification"].includes(key)?"::jsonb":"")); values.push(["result","verification"].includes(key)?json(value):value); i++;
  }
  if (!fields.length) return false;
  fields.push("updated_at=NOW()");
  const r=await db().query("UPDATE apex_execution_nodes SET "+fields.join(",")+" WHERE id=$1",values);
  return r.rowCount===1;
}

export async function recoverStaleIntelligenceNodes() {
  if (!enabled()) return {nodes:0,plans:0};
  const r=await db().query(`UPDATE apex_execution_nodes n SET status='pending',worker_task_id=NULL,worker_lease_token=NULL,last_error='Recovered after expired worker lease',updated_at=NOW() WHERE status IN ('queued','running') AND worker_task_id IN (SELECT id FROM durable_jobs WHERE status IN ('queued','running') AND lease_expires_at < NOW())`);
  return {nodes:r.rowCount,plans:0};
}

export async function setPlanStatus(id,status,patch={}) {
  if (!enabled()) return false;
  const allowed=new Set(["planned","running","paused","completed","failed","cancelled"]);
  if (!allowed.has(status)) throw new Error("Invalid plan status");
  const r=await db().query(`UPDATE apex_execution_plans SET status=$2,result=COALESCE($3::jsonb,result),
    last_error=COALESCE($4,last_error),version=version+1,updated_at=NOW() WHERE id=$1`,
    [id,status,patch.result===undefined?null:json(patch.result),patch.lastError??null]);
  return r.rowCount===1;
}

export async function closeDurableIntelligenceStore() { if(pool) await pool.end(); pool=null; }
