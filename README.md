# Apex Bible Story Studio

Apex Studio is focused on one job: turning Bible stories into source-aware cinematic videos.

## Workflow

Scripture → research → story → characters/world → scenes/shots → visuals → narration/audio → timeline → render → release

## Core systems

- Biblical Story Engine — ordered biblical events with source references and dramatization labels.
- Bible Catalog — Bible families and editions without bundling copyrighted translations.
- Research & Sources — provenance, edition/translation, locators, and interpretation boundaries.
- Characters & World — visual identity, relationships, locations, and continuity.
- Oracle — cinematic script generation from Bible-story inputs.
- Forge — cinematic visual generation.
- Bard — narration/audio generation.
- Scenes & Timelines — editable cinematic sequences.
- Production & Render — dependencies, render jobs, assets, and releases.
- Realism — consistent visual style and shot continuity.

## Source discipline

Keep Scripture, tradition, historical/scholarly evidence, dramatization, and original fiction explicitly distinct. Generated scenes should retain their source provenance.

## Running

```bash
npm install
npm start
```

Then open http://localhost:3010 on the host, or `http://<LAN-IP>:3010` from an authorized device on the same private network. By default the server binds to `0.0.0.0` but rejects non-private inbound addresses.

## API

The main creative API is under /api/studio. Production routes are /api/oracle, /api/forge, and /api/bard.

The repository no longer includes adult/intimacy, LAYERS, Stark Mode, companion, or unrelated universe features.


## APEX OMNI-STUDIO

The OMNI workspace adds the SE-X retrieval pipeline, encrypted local result storage, live search events, narrative branch mapping, prosody parsing, and production/render monitoring.

SE-X outbound retrieval is deny-by-default. Configure explicit destinations with `APEX_SEX_ALLOWED_HOSTS`. The application never forwards stored credentials to retrieved sources, and telemetry remains disabled.

OMNI persistence is encrypted with AES-256-GCM. Set `APEX_OMNI_STORE_KEY` for deterministic key management, or the application generates a local 0600 key under the OMNI data directory.
