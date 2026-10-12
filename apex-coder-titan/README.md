# Apex Coder Titan

Apex Coder Titan is the iPhone-first browser control plane for the Apex engineering pipeline.

## Contract

Titan is an engineering orchestrator, not a self-certifying coder. It:

- refuses to operate on a dirty source checkout;
- creates an isolated detached worktree from the exact source HEAD;
- discovers repository checks instead of assuming a fixed command;
- uses stateful OpenAI Responses API turns with `previous_response_id`;
- runs six specialist audits plus a Lead Architect;
- permits up to 72 implementation rounds;
- performs up to 7 repair passes, with up to 20 stateful repair turns per pass;
- persists run evidence outside the source checkout;
- detects source-HEAD races before accepting a result;
- blocks path escapes and protected secret/config paths;
- scans final changed text for common credential patterns;
- supports cancellation and live SSE event streaming;
- never force-pushes, resets, deletes branches, or merges remotely;
- returns GREEN/YELLOW/RED based on explicit evidence;
- does not promote or merge automatically.

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

The default API model is `gpt-5.6-sol`; override it with `OPENAI_MODEL` if your account uses another supported model.

## Safety contract

Titan only runs repository commands it discovers from package scripts and executes them without a shell. AI writes are atomic and confined to the detached worktree. The source checkout is never used as the AI's write target.

A successful run is evidence-backed; an AI statement such as "done" can never make the run GREEN by itself.
