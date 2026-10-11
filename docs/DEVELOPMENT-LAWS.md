# Apex Development Laws

**Status:** User-approved operating requirements for Apex Studio work. Apply these during project planning, implementation, troubleshooting, and deployment. These rules exist to reduce the user's manual burden and preserve continuity.

## 1. Voice first

The user may be tired of typing and is working from an iPhone. Prefer voice input, dictation, short commands, and natural-language requests wherever the available interface supports them. Do not require lengthy technical write-ups when a short instruction plus established context is enough.

## 2. Preserve the vision and project memory

- Preserve approved ideas, names, canon, architecture, constraints, and decisions.
- Consult existing project documents and conversation context before asking the user to repeat established information.
- Record durable decisions in the relevant repository documents as work proceeds; do not rely on chat history alone for critical requirements.
- Keep documents consistent. If two existing requirements conflict, identify the conflict and ask or investigate before changing either one.
- Never casually rename, remove, or reinterpret user-established concepts.

## 3. Automate the work

Automate build checks, tests, validation, deployment, and post-deployment checks where practical and available. Prefer the smallest safe workflow that reduces repeated manual steps. Report what actually ran and distinguish verified results from assumptions.

## 4. iPhone-only

Assume the user's iPhone is their only development computer unless they explicitly say otherwise. Instructions, interfaces, editing steps, troubleshooting, and deployment workflows must be feasible on the phone. Never quietly assume access to a Mac, PC, desktop terminal, or physical keyboard. Favor mobile-friendly interfaces and copy/paste-light workflows.

## 5. Free first

Assume a $0 budget unless the user explicitly updates this constraint. Prioritize genuinely free options, open-source tools, existing accounts/infrastructure, and free tiers. Before suggesting a paid service, subscription, hardware purchase, or developer program, check for a viable free alternative and explain any unavoidable limitation plainly. Do not create new billable resources without explicit approval.

## 6. Short instructions, full execution

The user can provide a brief, informal, typo-filled, or voice-dictated request. Use established context and reasonable assumptions to move the work forward. Ask a concise question only when an important decision cannot safely be inferred. Do as much of the actual work as the connected tools allow instead of returning a long checklist for the user to execute.

## 7. No lost progress

When an idea or decision becomes important, update the appropriate source of truth (for example, this file, `AGENTS.md`, a feature specification, or architecture document). Keep changes scoped and traceable. State where a decision was recorded and provide a direct link when possible. If a change cannot be persisted, say so plainly.

## 8. Preserve existing systems and verify honestly

- Prefer isolated, reversible changes and preserve working infrastructure.
- Do not claim a build, test, offline inference, merge, or deployment succeeded unless there is evidence that it did.
- Distinguish code merged, deployment completed, and behavior verified on the user's device; these are separate milestones.
- For local/offline AI work, verify that inference works offline and obtain explicit permission before adding external model/provider network calls.
- When a defect appears, investigate its root cause and check the relevant logs/state before making speculative changes.

## 9. User canon and authority

The user's established project names, canon, and approved decisions take precedence over casual assistant wording. Suggestions are not decisions until the user approves them. Preserve exact spelling and capitalization where specified. The user retains final authority over product direction and meaningful trade-offs.

## 10. A practical workflow for every change

1. **Recall:** Check the relevant project context and existing docs.
2. **Scope:** Identify the smallest change that addresses the request; note conflicts or risks.
3. **Preserve:** Record any new durable decision in the relevant documentation.
4. **Implement:** Make an isolated change using the tools available.
5. **Verify:** Run appropriate checks and inspect results when possible.
6. **Report:** Explain briefly what changed, what was verified, what remains unverified, and any user action that is genuinely necessary.

Keep the user's effort low: no unnecessary forms, repeated questions, paid prerequisites, or manual work that can reasonably be automated.
