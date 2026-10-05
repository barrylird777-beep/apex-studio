# APEX LIGHTNING RESOURCE ARSENAL

Objective: maximize engineering throughput from an iPhone while keeping Apex production-grade. External resources are specialist instruments, never authority.

## CODING / AGENT HARNESS CANDIDATES
- OpenHands, OpenCode, Goose, Aider
- Cline, Roo Code, Kilo Code
- SWE-agent, mini-SWE-agent
- Gemini CLI, Codex CLI, Claude Code
- AutoCodeRover / other issue-solving harnesses where verified
Use only when they can produce auditable repository evidence. Current benchmark evidence shows agent scaffolding materially changes coding performance, so Apex should benchmark harnesses rather than assume the model alone determines quality. citeturn0search1turn0search4

## AGENT / MCP / SKILL SECURITY
- Codex Security candidate
- CodeQL, Semgrep
- Gitleaks
- Trivy, Grype
- OSV-Scanner
- OWASP ZAP, Nuclei
- Syft/SBOM tooling
- MCP/skill scanners such as mcp-scan
- Cisco AI Defense MCP/A2A/Skill scanners
MCP-scan can inventory agent components and detect prompt injection, tool poisoning, toxic flows, secret handling problems and malicious skill behavior; it also supports runtime proxying/guardrails. citeturn0search0turn0search5turn0search8
Do not blindly install or trust a third-party MCP/skill. Scan it before promotion.

## TEST / FAILURE ENGINEERING
- node:test and native repository test infrastructure
- Playwright — browser/E2E
- k6 / Artillery — load
- Schemathesis / fast-check — property testing
- mutation testing
- process-kill/crash recovery tests
- worker lease/duplicate-execution torture tests
- provider outage/rate-limit simulation
- malformed media corpus and FFmpeg failure injection

## REPOSITORY / DELIVERY
- GitHub Actions, branch protection, required checks, CODEOWNERS
- Railway runtime/deployment diagnostics
- dependency update automation
- SBOM + artifact provenance
- release evidence
- isolated branches/worktrees for autonomous mutations

## RESEARCH / INTELLIGENCE
- GitHub source/history mining
- official vendor documentation first
- Context7
- Exa/Tavily when connected
- agent/model/tool benchmark tracking
- security research and CVE/OSV intelligence
- continuous discovery of new agents, MCP servers, skills and testing/security tools

## NEW APEX RESOURCE FORCES
### RESOURCE SCOUT
Continuously discover candidate tools/agents/skills.

Pipeline:
DISCOVER -> CLASSIFY -> LICENSE/COST CHECK -> SECURITY SCAN -> SANDBOX TRIAL -> BENCHMARK -> EVIDENCE -> PROMOTE/REJECT

### AGENT SECURITY FORCE
Audit the agents and tools themselves:
prompt injection, tool poisoning, toxic flows, secrets, permissions, supply chain, malicious dependencies, provenance/hash drift, exfiltration, privilege escalation.

### DIFFERENTIAL AGENT FORCE
Give identical bounded Apex tasks to independent harnesses and compare:
correctness, tests, security, regression rate, cost, latency, evidence quality.

### RUNTIME POLICY FORCE
Define permissions between an agent and:
filesystem, Git, network, secrets, PostgreSQL, Railway, deployments, and merge operations.
No agent receives unrestricted production authority.

### AI INTELLIGENCE SCOUT
Continuously monitor:
new models, coding agents, MCP servers, skills, security tools, testing frameworks, PostgreSQL techniques, media tooling and deployment capabilities.
Verify claims against primary sources before promotion.

## APEX OPERATING MODEL
Apex should evolve toward:

COMMAND CENTER
-> ARCHITECTS
-> BUILDERS
-> RESEARCHERS
-> TITAN
-> BREAKERS
-> SECURITY
-> CHAOS
-> VALIDATORS
-> INTEGRATION
-> KING COB
-> MAIN

The resource layer sits underneath these forces:
AGENT HARNESS + MODEL MESH + MCP/SKILLS + SECURITY + TESTING + RESEARCH + DEPLOYMENT

## APEX RULES
1. No external tool gets direct authority to merge production code.
2. No SQLite for the durable worker foundation.
3. No speculative Redis/queue/infrastructure.
4. Every agent works from actual repository state.
5. Every mutation requires diff + focused tests + evidence.
6. Builders never self-certify.
7. Breakers actively attempt to falsify claimed fixes.
8. Integration checks cross-workstream compatibility.
9. King Cob remains final inspector.
10. Never claim an external agent ran unless repository/tool evidence proves it.
11. Third-party agent/MCP/skill adoption requires security/provenance review.
12. Benchmark tools on real Apex work, not marketing claims.

## MOBILE-FIRST
Because the owner operates from iPhone, prioritize cloud/browser/GitHub-native execution. Local-terminal setup must not be a prerequisite for coordination or progress.

## CURRENT PRIORITY
Auth/security -> durable queue -> worker fleet -> AI mesh -> media -> API contracts -> CI/release -> chaos/load -> final integration.

This document is a RESOURCE MAP. It is not proof that any external service is connected or executing.

### Active resource work packets
- RESOURCE-01: Agent Resource Scout & Promotion Pipeline
- RESOURCE-02: Agent/MCP/Skill Supply-Chain Security Gate
- RESOURCE-03: Competitive Agent Differential Bench
- RESOURCE-04: Agent Runtime Permission Firewall
- RESOURCE-05: Continuous AI/Tool Intelligence Scout
