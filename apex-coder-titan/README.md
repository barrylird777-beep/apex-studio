# Apex Coder Titan

Apex Coder Titan is the iPhone-first browser control plane for the Apex engineering pipeline.

## Contract

Titan is an engineering orchestrator, not a self-certifying coder. It:

- confines all repository work to the selected Apex checkout;
- creates an isolated detached worktree for implementation;
- discovers available checks instead of assuming a fixed command;
- uses stateful OpenAI Responses API turns with `previous_response_id`;
- runs six specialist audits plus a Lead Architect review;
- permits up to 72 implementation rounds;
- permits up to 7 repair passes with up to 20 turns each;
- persists evidence for every check and decision;
- detects races and conflicting file changes;
- never force-pushes, resets, deletes branches, or merges remotely;
- promotes only after the King Cob gate is GREEN;
- returns GREEN/YELLOW/RED with evidence.

## Run

```bash
cd apex-coder-titan
cp .env.example .env
# put OPENAI_API_KEY in .env
npm start
```

Open `http://127.0.0.1:8787`.

For a smoke test without an API key:

```bash
npm test
```

The web app accepts a repository path and an engineering assignment. Titan defaults to a non-destructive audit/implementation workflow; remote Git operations are never performed by Titan.
