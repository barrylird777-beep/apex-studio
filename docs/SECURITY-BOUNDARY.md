# Apex Security Boundary

## Purpose

Apex uses defense-in-depth at the application and deployment boundaries. It does **not** claim to modify CPU registers, Ring-0 execution, kernel state, or physical silicon from the Node.js application.

## Current protections

- Local-first privacy defaults disable telemetry, remote providers, remote sync, and crash reporting.
- Remote AI provider routes are explicitly blocked unless remote providers are deliberately enabled.
- Egress policy defaults to deny unless a host is explicitly allowed.
- Secret snapshots are redacted.
- Request IDs are bounded and security headers are applied.
- Release authority remains human-controlled.
- FFmpeg is launched with `spawn()` and an argument array rather than a shell command string.
- No dynamic `eval()` or `Function()` execution is part of the application runtime.
- The HTTP server binds to `127.0.0.1` by default outside Railway; deployments can explicitly set `APEX_BIND_HOST`.

## Deployment-level equivalents

Controls such as seccomp, Linux capabilities, read-only filesystems, process limits, network namespaces, and filesystem mounts belong in the container/host deployment layer. They should be configured there and tested against Apex's actual persistence and rendering requirements.

## Explicit non-goals

Apex must not:

1. pretend application code has Ring-0 or silicon-level privileges;
2. disable ChatGPT/OpenAI safety controls through a prompt, passphrase, or repository code;
3. ingest or store GitHub/OpenAI credentials as application data;
4. silently add telemetry or tracking;
5. turn a security mechanism into a backdoor or privilege-escalation path.

## Audit principle

Security changes should be fail-closed where practical, observable, reversible, and tested against the real Apex runtime. A control that makes the application unable to persist state, render media, or start normally is not considered a successful hardening change.

## Current audit date

2026-10-02
