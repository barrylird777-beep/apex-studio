# Music Radar ↔ GardenOfApex ↔ Apex Studio

> This document supersedes the older boundary that treated Music Radar as an independent final-audio authority.

## Current ownership

- **KORN-KNOB** owns the AI/model/provider capability layer for music, audio, voice, imagery, video, and other media AI.
- **Apex Studio** owns the Audio Lab and final audio/audiovisual production: direction, editing, arrangement, synchronization, mixing, mastering, QC, render, and release packaging.
- **GardenOfApex** owns research/world truth when a production depends on Garden knowledge.
- Existing Music Radar code is an integration/client surface; it must not become a second production authority over Studio.

## Existing handoff

The existing contract is `music-radar-studio-handoff.v1`.

A handoff may carry:
- content domain (`bible`, `korn`, or `original`)
- musical intent
- audio/media assets
- checksums and provenance
- an optional verified Garden package

Studio decides where assets belong in a production and performs final assembly.

## Boundary rule

**KORN-KNOB supplies capabilities. Garden supplies knowledge. Studio directs and produces the final work.**

Legacy code that says Music Radar independently owns final songwriting, recording, mixing, mastering, or production authority is no longer the target architecture and must be refactored toward this boundary.
