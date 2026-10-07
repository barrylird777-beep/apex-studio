import { privacyStatus } from "./apex-privacy.mjs";

const BLOCKED_TELEMETRY=[
  "OTEL_EXPORTER_OTLP_ENDPOINT","OTEL_EXPORTER_OTLP_HEADERS","OTEL_EXPORTER_OTLP_PROTOCOL",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT","OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
  "DD_TRACE_ENABLED","DD_AGENT_HOST","DD_API_KEY","DD_SITE","SENTRY_DSN","SENTRY_AUTH_TOKEN",
  "SENTRY_ENVIRONMENT","SENTRY_RELEASE"
];

export function installPrivacyGuard(){
  for(const name of BLOCKED_TELEMETRY) delete process.env[name];

  if(String(process.env.APEX_PRIVACY_SILENCE_LOGGING||"true").toLowerCase()!=="false"){
    const sink=()=>{};
    console.debug=sink;
    console.info=sink;
  }
  return privacyStatus();
}

export const PRIVACY_BLOCKED_ENV=Object.freeze([...BLOCKED_TELEMETRY]);
