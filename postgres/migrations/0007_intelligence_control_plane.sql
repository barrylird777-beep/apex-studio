CREATE TABLE IF NOT EXISTS apex_agents (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','busy','degraded','quarantined','retired')),
  capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  last_heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS apex_execution_plans (
  id UUID PRIMARY KEY,
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','running','paused','completed','failed','cancelled')),
  graph JSONB NOT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  last_error TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS apex_execution_nodes (
  id UUID PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES apex_execution_plans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  capability TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','queued','running','completed','failed','blocked','cancelled')),
  depends_on UUID[] NOT NULL DEFAULT '{}'::uuid[],
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  worker_task_id UUID REFERENCES apex_worker_tasks(id) ON DELETE SET NULL,
  result JSONB,
  verification JSONB,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(plan_id, name)
);

CREATE INDEX IF NOT EXISTS apex_execution_nodes_ready_idx
  ON apex_execution_nodes(plan_id, status, updated_at);

CREATE INDEX IF NOT EXISTS apex_execution_nodes_task_idx
  ON apex_execution_nodes(worker_task_id);

CREATE INDEX IF NOT EXISTS apex_agents_heartbeat_idx
  ON apex_agents(status, last_heartbeat_at);

CREATE INDEX IF NOT EXISTS apex_execution_plans_status_idx
  ON apex_execution_plans(status, updated_at);

CREATE TABLE IF NOT EXISTS apex_agent_events (
  id BIGSERIAL PRIMARY KEY,
  agent_id TEXT REFERENCES apex_agents(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES apex_execution_plans(id) ON DELETE CASCADE,
  node_id UUID REFERENCES apex_execution_nodes(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS apex_agent_events_plan_idx
  ON apex_agent_events(plan_id, created_at);

CREATE INDEX IF NOT EXISTS apex_agent_events_agent_idx
  ON apex_agent_events(agent_id, created_at);
