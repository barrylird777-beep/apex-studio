# Top-Level Express Route Inventory — Initial Static Pass

Status: INVENTORY BASELINE ONLY; not an authorization certification.
Source: `server.mjs` on audited `main` snapshot `2e7b85c09f70b134a5a3b21090faa0fa6294049a`.
Generated from route declarations visible in the file. Mounted routers and route handlers declared in other modules are not included in this list.

## Interpretation warning

The guard column is a textual scan of the first eight lines after each route declaration. It is not a complete middleware/control-flow analysis. “No route-specific auth guard visible” does **not** prove a route is publicly exploitable: global middleware, nested routers, handler checks, public design, or upstream controls may apply. Conversely, a visible guard does not prove the identity or permission scope is correct. Every route needs an explicit owner-approved classification and behavior tests.

Total top-level route declarations found: **150**.

| Source line | Method | Route | Static observation |
|---:|---|---|---|
| 87 | GET | `/local-ai-sw.js` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 151 | GET | `/api/auth/session` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 161 | POST | `/api/auth/sign-in` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 200 | POST | `/api/auth/sign-out` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 295 | GET | `/api/search` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 317 | GET | `/api/workforce/status` | control-plane guard visible nearby |
| 326 | POST | `/api/workforce/burst` | control-plane guard visible nearby |
| 347 | GET | `/api/relay/health` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 364 | GET | `/api/shield-apex/status` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 375 | GET | `/api/internal/worker/health` | worker guard visible nearby |
| 380 | GET | `/api/internal/worker/stats` | worker guard visible nearby |
| 395 | POST | `/api/internal/store/get` | worker guard visible nearby |
| 406 | POST | `/api/internal/store/query` | worker guard visible nearby |
| 439 | POST | `/api/internal/store/put` | worker guard visible nearby |
| 453 | POST | `/api/internal/teevee/enqueue` | worker guard visible nearby |
| 479 | POST | `/api/internal/worker/enqueue` | worker guard visible nearby |
| 508 | POST | `/api/internal/worker/claim` | worker guard visible nearby |
| 520 | POST | `/api/internal/worker/recover` | worker guard visible nearby |
| 529 | POST | `/api/internal/worker/:jobId/heartbeat` | worker guard visible nearby |
| 538 | POST | `/api/internal/worker/:jobId/complete` | worker guard visible nearby |
| 547 | POST | `/api/internal/worker/:jobId/fail` | worker guard visible nearby |
| 556 | POST | `/api/internal/worker/release` | worker guard visible nearby |
| 566 | GET | `/api/apex/readiness` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 590 | GET | `/api/broadcast/status` | control-plane guard visible nearby |
| 591 | POST | `/api/broadcast/start` | control-plane guard visible nearby |
| 595 | POST | `/api/broadcast/stop` | control-plane guard visible nearby |
| 653 | GET | `/health` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 666 | GET | `/ready` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 699 | GET | `/api/health` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 717 | POST | `/api/paypex/brief` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 727 | GET | `/api/apex/apps` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 739 | GET | `/api/apex/apps/:appId/status` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 779 | GET | `/api/koin-kob/status` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 788 | GET | `/api/koin-kob/simulations` | control-plane guard visible nearby |
| 809 | POST | `/api/koin-kob/simulation` | control-plane guard visible nearby |
| 845 | GET | `/api/canon/trajectory` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 857 | POST | `/api/canon/handoff` | control-plane guard visible nearby |
| 905 | GET | `/api/canon/handoff` | control-plane guard visible nearby |
| 922 | GET | `/api/canon/handoff/status` | control-plane guard visible nearby |
| 944 | GET | `/api/canon/apps/:appId/neighbors` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 955 | GET | `/api/canon/apps` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 964 | GET | `/api/canon/apps/:appId/status` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 975 | POST | `/api/canon/apps/ko-blocks/validate` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 995 | GET | `/api/planet-apex/status` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 999 | GET | `/api/kernel-vision/status` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 1003 | GET | `/api/kash-korner/status` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 1007 | GET | `/api/kernelodies/status` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 1011 | GET | `/api/xshield/status` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 1015 | GET | `/api/koin-kob/status` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 1021 | GET | `/api/kash-korner/opportunities` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 1030 | POST | `/api/kash-korner/opportunities` | opportunity-engine guard visible nearby |
| 1049 | GET | `/api/projects` | control-plane guard visible nearby |
| 1053 | POST | `/api/projects` | control-plane guard visible nearby |
| 1057 | GET | `/api/projects/:id/overview` | control-plane guard visible nearby |
| 1063 | PUT | `/api/projects/:id` | control-plane guard visible nearby |
| 1069 | DELETE | `/api/projects/:id` | control-plane guard visible nearby |
| 1075 | GET | `/api/projects/:id/scenes` | control-plane guard visible nearby |
| 1081 | POST | `/api/projects/:id/scenes` | control-plane guard visible nearby |
| 1087 | PUT | `/api/scenes/:id` | control-plane guard visible nearby |
| 1093 | DELETE | `/api/scenes/:id` | control-plane guard visible nearby |
| 1099 | DELETE | `/api/scenes/:id/assignment` | control-plane guard visible nearby |
| 1105 | GET | `/api/projects/:id/shoot-days` | control-plane guard visible nearby |
| 1111 | POST | `/api/projects/:id/shoot-days` | control-plane guard visible nearby |
| 1117 | GET | `/api/shoot-days/:id` | control-plane guard visible nearby |
| 1123 | DELETE | `/api/shoot-days/:id` | control-plane guard visible nearby |
| 1129 | POST | `/api/shoot-days/:id/scenes` | control-plane guard visible nearby |
| 1133 | PUT | `/api/shoot-days/:id/order` | control-plane guard visible nearby |
| 1137 | GET | `/api/projects/:id/calendar` | control-plane guard visible nearby |
| 1143 | POST | `/api/projects/:id/auto-schedule` | control-plane guard visible nearby |
| 1151 | GET | `/api/kash-korner/entries` | control-plane guard visible nearby |
| 1163 | POST | `/api/kash-korner/entries` | control-plane guard visible nearby |
| 1175 | GET | `/api/kernel-vision/items` | control-plane guard visible nearby |
| 1185 | POST | `/api/kernel-vision/sessions` | control-plane guard visible nearby |
| 1203 | GET | `/api/kernel-vision/sessions` | control-plane guard visible nearby |
| 1213 | GET | `/api/kernelodies/tracks` | control-plane guard visible nearby |
| 1223 | POST | `/api/kernelodies/tracks` | control-plane guard visible nearby |
| 1610 | GET | `/api/teevee/buyer` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 1619 | GET | `/local-ai` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 1628 | GET | `/` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 1629 | GET | `/api/network/adblock/content/status` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 1633 | GET | `/api/network/adblock/content/rules` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 1638 | GET | `/api/network/adblock/content/classify` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 1646 | GET | `/api/network/adblock/profile` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 1680 | GET | `/api/network/throughput` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 1723 | POST | `/api/network/client-telemetry` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 1763 | GET | `/api/network/status` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 1778 | GET | `/api/studio/omni/events` | control-plane guard visible nearby |
| 1819 | GET | `/api/music-radar/status` | control-plane guard visible nearby |
| 1823 | POST | `/api/music-radar/handoff` | control-plane guard visible nearby |
| 1884 | POST | `/api/rapid/preview` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 1908 | POST | `/api/rapid/orders` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 1956 | GET | `/api/rapid/assets/:id` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 1985 | GET | `/api/rapid/orders/:id` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 2008 | GET | `/api/capacity` | control-plane guard visible nearby |
| 2009 | GET | `/api/workers/permanent` | control-plane guard visible nearby |
| 2014 | GET | `/api/workers/overseer` | control-plane guard visible nearby |
| 2015 | GET | `/api/workers/durable` | control-plane guard visible nearby |
| 2017 | GET | `/api/network/rogue-ap/status` | control-plane guard visible nearby |
| 2021 | POST | `/api/network/rogue-ap/trust` | control-plane guard visible nearby |
| 2029 | POST | `/api/network/rogue-ap/revoke` | control-plane guard visible nearby |
| 2037 | POST | `/api/network/rogue-ap/observations` | control-plane guard visible nearby |
| 2045 | POST | `/api/episodes/produce` | control-plane guard visible nearby |
| 2072 | GET | `/api/episodes/:episodeId/:artifactId/download` | control-plane guard visible nearby |
| 2120 | GET | `/korn-knob` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 2707 | POST | `/api/oracle` | control-plane guard visible nearby |
| 2728 | POST | `/api/forge` | control-plane guard visible nearby |
| 2838 | POST | `/api/audio` | control-plane guard visible nearby |
| 2909 | GET | `/api/audio/status` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 2962 | POST | `/api/media/image` | control-plane guard visible nearby |
| 2977 | POST | `/api/media/video` | control-plane guard visible nearby |
| 3017 | GET | `/api/media/status` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 3040 | GET | `/api/project` | control-plane guard visible nearby |
| 3058 | GET | `/api/render/status` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 3067 | POST | `/api/render/export` | control-plane guard visible nearby |
| 3186 | POST | `/api/ai/generate-max` | control-plane guard visible nearby |
| 3209 | GET | `/api/ai/generate-max/status` | control-plane guard visible nearby |
| 3213 | POST | `/api/ai/generate-grok` | control-plane guard visible nearby |
| 3233 | GET | `/api/ai/generate-grok/status` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 3237 | GET | `/api/apex/universe` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 3251 | GET | `/api/ai/catalog` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 3255 | GET | `/api/ai/providers` | control-plane guard visible nearby |
| 3259 | POST | `/api/ai/generate/:provider` | control-plane guard visible nearby |
| 3271 | POST | `/api/ai/generate` | control-plane guard visible nearby |
| 3293 | POST | `/api/ai/collaborate` | control-plane guard visible nearby |
| 3315 | GET | `/api/ai/status` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 3330 | POST | `/api/mesh/jobs` | control-plane guard visible nearby |
| 3340 | GET | `/api/mesh/workers` | control-plane guard visible nearby |
| 3344 | GET | `/api/crew/status` | control-plane guard visible nearby |
| 3348 | POST | `/api/crew/jobs` | control-plane guard visible nearby |
| 3361 | POST | `/api/crew/burst` | control-plane guard visible nearby |
| 3370 | GET | `/api/mesh/status` | control-plane guard visible nearby |
| 3396 | GET | `/api/voiceover/voices` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 3404 | GET | `/api/voiceover/status` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 3412 | GET | `/api/voiceover/jobs/:id` | control-plane guard visible nearby |
| 3427 | POST | `/api/voiceover/jobs` | control-plane guard visible nearby |
| 3437 | GET | `/api/network/adblock/profile` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 3450 | GET | `/api/network/adblock/status` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 3451 | ALL | `/api/network/adblock/doh` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 3542 | GET | `/api/korn-knob/status` | no route-specific auth guard visible in first 8 lines; review middleware/handler |
| 3551 | POST | `/api/korn-knob/ideas` | control-plane guard visible nearby |
| 3561 | POST | `/api/korn-knob/ideas/evaluate` | control-plane guard visible nearby |
| 3579 | POST | `/api/korn-knob/worker-job` | control-plane guard visible nearby |
| 3594 | GET | `/api/engine-apex/chat-runtime/state` | control-plane guard visible nearby |
| 3604 | PATCH | `/api/engine-apex/chat-runtime/state` | control-plane guard visible nearby |
| 3624 | GET | `/api/engine-apex/chat-runtime/events` | control-plane guard visible nearby |
| 3634 | POST | `/api/engine-apex/chat-runtime/events` | control-plane guard visible nearby |
| 3652 | GET | `/api/engine-apex/chat-runtime/status` | control-plane guard visible nearby |
| 3670 | GET | `/api/engine-apex/snapshot` | control-plane guard visible nearby |
| 3680 | POST | `/api/engine-apex/brief` | control-plane guard visible nearby |
| 3690 | GET | `/api/engine-apex/status` | no route-specific auth guard visible in first 8 lines; review middleware/handler |

## Required next steps
1. Add intended access class per route: public, owner-only, app-scoped, worker-only, or peer-only.
2. Read the complete handler and applicable global/nested middleware.
3. Verify identity and authorization, including cross-app access denial and owner workflow preservation.
4. Add negative tests for unauthorized calls and positive tests for legitimate callers.
5. Inventory every router mounted with `app.use` and repeat the process for route declarations inside those modules.
6. Record tested, deployed, and independently verified evidence separately.
