# Music Radar ↔ Garden of Apex ↔ Apex Studio

Music Radar remains a standalone music product. It owns music and audio creation; Apex Studio consumes verified audio packages instead of reimplementing the music app.

## Ownership

Music Radar owns songwriting, composition, genre fusion, recording, vocals, narration, dialogue, music, score, ambience, SFX, sound design, editing, mixing, mastering, WAV/MP3 export, local projects, and musical taste/profile intelligence.

Apex Studio owns film/video story production, visual generation and continuity, timeline/edit assembly, render and media QC, provenance, release packaging, and durable worker orchestration.

Garden of Apex owns the fictional world, Jesus Freaks, relationships, places, rules, and world-state, delivered as versioned packages when a production depends on Garden state.

## Handoff

The integration contract is `music-radar-studio-handoff.v1`.

Music Radar sends a content domain (`bible`, `korn`, or `original`), musical intent, exported audio assets with checksums/provenance, and an optional Garden package.

Bible productions do not require Garden references. Korn productions can carry verified Garden references. Original productions can remain independent.

## Boundary rule

**Music Radar creates the sound. Apex Studio directs where that sound belongs in the film. Garden of Apex supplies world truth only when the production uses Garden content.**

The Studio must never silently replace a Music Radar asset with an unverified audio asset.
