// Warn-only Apex deployment policy checks. Never blocks startup.
export function enforceApexPolicy(env = process.env) {
  const w = [];
  const host = env.APEX_BIND_HOST ?? '127.0.0.1';
  if (env.DISABLE_TELEMETRY !== 'true') w.push('DISABLE_TELEMETRY is not "true"');
  if (!env.APEX_COMMANDER_TOKEN || env.APEX_COMMANDER_TOKEN === 'change-me') w.push('APEX_COMMANDER_TOKEN not set');
  else if (env.APEX_COMMANDER_TOKEN.length < 16) w.push('APEX_COMMANDER_TOKEN is short');
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !String(env.APEX_ENV ?? '').startsWith('production')) {
    w.push(`Public host ${host} without APEX_ENV=production*`);
  }
  if (w.length) console.warn('[POLICY WARN]\n - ' + w.join('\n - '));
  else console.log('[POLICY OK]');
}

export function safeLog(...args) {
  const secrets = [process.env.APEX_COMMANDER_TOKEN].filter(Boolean);
  console.log(...args.map((a) => {
    let s = typeof a === 'string' ? a : JSON.stringify(a);
    for (const x of secrets) s = s.split(x).join('[REDACTED]');
    return s.replace(/apex_session=[^;\s]+/g, 'apex_session=[REDACTED]');
  }));
}
