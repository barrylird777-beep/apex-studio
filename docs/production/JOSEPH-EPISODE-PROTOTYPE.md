# KernelVision — Joseph episode prototype

This command renders a 30-second, 16:9 episode through the production `produceKernelVisionEpisode` pipeline.

## Reproduce

On Ubuntu/Debian, install the free system tools:

```sh
sudo apt-get update
sudo apt-get install -y ffmpeg espeak librsvg2-bin
npm install
npm run smoke:kernelvision-episode
```

The smoke script writes:

- `artifacts/kernelvision-smoke/joseph-from-pit-to-forgiveness.mp4`
- `artifacts/kernelvision-smoke/joseph-from-pit-to-forgiveness.srt`

The CI workspace keeps these outputs only for the duration of the run; no hosted artifact is uploaded or retained.

## What is real in this prototype

- Ten original vector scene illustrations are rasterized to 1920×1080 PNG frames.
- `espeak` produces the narration, split and padded to align with the ten 3-second shots.
- FFmpeg builds a 24 fps H.264/AAC MP4, mixes a 432 Hz test ambience, and writes subtitles.
- The existing episode pipeline runs its hook validation, FFprobe spec checks, render QC, artifact hashing, and metadata handoff.

## What is still synthetic or incomplete

- Artwork is authored vector illustration, not model-generated anime footage.
- Narration is synthetic `espeak` speech, not a final voice performance.
- The 432 Hz bed is a test tone, not a finished Jesus Freaks composition.
- Provenance is marked unverified. The artifact is **not publication-eligible** and requires replacement with approved media plus human review.
- The test's in-memory fabric is a test fixture, not durable peer storage. This render does not prove sovereign persistence or production deployment.

This prototype proves the existing media assembly/QC path can export an actual video file; it does not certify the entire production system.
