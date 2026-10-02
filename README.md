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

Then open http://localhost:3000.

## API

The main creative API is under /api/studio. Production routes are /api/oracle, /api/forge, and /api/bard.

The repository no longer includes adult/intimacy, LAYERS, Stark Mode, companion, or unrelated universe features.
