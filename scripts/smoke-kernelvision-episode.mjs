import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { produceKernelVisionEpisode } from "../src/video/episode-pipeline.mjs";

const exec = promisify(execFile);
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const root = await mkdtemp(path.join(tmpdir(), "kernelvision-export-smoke-"));
const records = [];
const exportDir = process.env.APEX_APPROVED_PEER_EXPORT_DIR ? path.resolve(process.env.APEX_APPROVED_PEER_EXPORT_DIR) : null;
const scenes = [
  ["They sold their own brother for silver.", "Brothers close around Joseph beneath a blood-red sunset.", "#100f20", "#9b4938"],
  ["His father's gift made jealousy burn.", "A torn ceremonial coat falls into dust.", "#21162c", "#bd6b4b"],
  ["The pit swallowed every cry for help.", "Joseph stands small at the bottom of a deep stone cistern.", "#080b17", "#35435b"],
  ["A caravan carried him toward Egypt.", "Camels cross a vast desert beneath a burning sky.", "#3a1d2d", "#e2a45e"],
  ["In Egypt, power wore a golden mask.", "Joseph enters a towering palace of columns and shadow.", "#17162a", "#d5aa62"],
  ["A lie sent the innocent into darkness.", "A lone figure stands behind the bars of an ancient prison.", "#090f1e", "#61748a"],
  ["Then Pharaoh's dreams shook the throne.", "A blazing sun and seven shadowed silhouettes rise over the Nile.", "#1d1830", "#f0bd63"],
  ["Joseph prepared the land before famine.", "Granaries tower over fields as storm clouds gather.", "#192b2c", "#c79b56"],
  ["The brothers returned, broken by hunger.", "Travelers kneel before Joseph in a hall of long shadows.", "#151a2a", "#a7b5c9"],
  ["He chose mercy, and the family lived.", "Joseph embraces his brothers beneath warm dawn light.", "#202039", "#e6c47e"]
];
const narrationLines = scenes.map(scene => scene[0]);
const palette = scenes.map(scene => [scene[2], scene[3]]);
function sceneSvg(index) {
  const colors = palette[index];
  const stars = Array.from({ length: 36 }, (_, i) =>
    '<circle cx="' + ((i * 173 + index * 71) % 1920) + '" cy="' + ((i * 97 + 33) % 620) +
    '" r="' + (i % 4 === 0 ? 3 : 1.5) + '" fill="#f7e6c3" opacity="' + (0.2 + (i % 5) * 0.12) + '"/>'
  ).join("");
  const figure = (x, y, scale, color, cloak) =>
    '<g transform="translate(' + x + ' ' + y + ') scale(' + scale + ')">' +
    '<circle cx="0" cy="-76" r="25" fill="' + color + '"/>' +
    '<path d="M-31 -48 Q0 -64 31 -48 L54 48 L30 100 L-30 100 L-54 48 Z" fill="' + cloak + '"/>' +
    '<path d="M-30 100 L-36 155 L-8 155 L0 102 L8 155 L36 155 L30 100 Z" fill="#111522"/>' +
    '<path d="M-28 -38 L-70 20 L-58 32 L-18 -6 M28 -38 L68 16 L56 28 L18 -6" fill="' + color + '"/>' +
    '</g>';
  let set = "";
  if (index === 2) set = '<ellipse cx="960" cy="1060" rx="650" ry="420" fill="#03050b"/><ellipse cx="960" cy="950" rx="420" ry="260" fill="#10182a"/>';
  else if (index === 3) set = '<path d="M0 790 L240 600 L430 790 L650 540 L880 790 L1100 610 L1320 790 L1570 560 L1920 800 V1080 H0Z" fill="#5a302f"/><path d="M0 900 Q500 760 1000 930 T1920 860 V1080 H0Z" fill="#171a29"/><g fill="#17131e"><ellipse cx="620" cy="755" rx="75" ry="38"/><path d="M580 720 L600 630 L630 630 L660 720Z"/><path d="M600 650 L550 610 L560 590 L620 630Z"/><ellipse cx="940" cy="760" rx="75" ry="38"/><path d="M900 720 L920 630 L950 630 L980 720Z"/></g>';
  else if (index === 4) set = '<path d="M250 1080 V360 L450 200 L650 360 V1080Z M1270 1080 V360 L1470 200 L1670 360 V1080Z" fill="#25243b"/><path d="M350 1080 V400 H550 V1080 M1370 1080 V400 H1570 V1080" fill="#d4a65e" opacity=".45"/><path d="M0 900 H1920 V1080 H0Z" fill="#0a0e1a"/>';
  else if (index === 5) set = '<path d="M0 0 H1920 V1080 H0Z" fill="#050913"/><path d="M180 0 V1080 M460 0 V1080 M1460 0 V1080 M1740 0 V1080" stroke="#56657a" stroke-width="18" opacity=".35"/><path d="M0 860 Q450 740 960 870 T1920 820 V1080 H0Z" fill="#0b1324"/><rect x="700" y="430" width="520" height="380" fill="#070b15" stroke="#62738a" stroke-width="16"/><path d="M730 470 H1190 M730 590 H1190 M730 710 H1190 M820 430 V810 M940 430 V810 M1060 430 V810" stroke="#6d7d91" stroke-width="12"/>';
  else if (index === 6) set = '<circle cx="960" cy="450" r="245" fill="#f4c46e" opacity=".85"/><circle cx="960" cy="450" r="310" fill="none" stroke="#f4c46e" stroke-width="8" opacity=".25"/>' + Array.from({length:7},(_,i)=>'<path d="M'+(430+i*175)+' 870 l-35 -150 l35 -80 l35 80 l-35 150Z" fill="#171726" stroke="#d9a45b" stroke-width="5"/>').join("");
  else if (index === 7) set = '<path d="M220 1080 V520 L420 370 L620 520 V1080Z M730 1080 V420 L960 250 L1190 420 V1080Z M1300 1080 V520 L1500 370 L1700 520 V1080Z" fill="#b58a4d" opacity=".8"/><path d="M0 850 Q480 760 960 880 T1920 820 V1080 H0Z" fill="#1c2929"/>';
  else if (index === 8) set = '<path d="M0 900 H1920 V1080 H0Z" fill="#090e19"/><path d="M200 900 V300 H400 V900 M1520 900 V300 H1720 V900" stroke="#8c9bb0" stroke-width="26" opacity=".35"/><path d="M650 1080 L960 500 L1270 1080Z" fill="#111827"/>';
  else if (index === 9) set = '<circle cx="1480" cy="260" r="180" fill="#ffd98a" opacity=".8"/><path d="M0 850 Q500 720 1000 850 T1920 820 V1080 H0Z" fill="#363149"/><path d="M0 960 Q500 850 1000 970 T1920 940 V1080 H0Z" fill="#171c2c"/>';
  else set = '<path d="M0 840 Q420 690 840 850 T1920 820 V1080 H0Z" fill="#24263b"/><path d="M0 930 Q500 800 1000 940 T1920 900 V1080 H0Z" fill="#111827"/>';
  const figures = index === 2 ? figure(960, 830, 0.8, "#d8b58b", "#9a5c4a")
    : index === 3 ? figure(820, 730, 0.75, "#c9a77d", "#2a2437") + figure(1100, 750, 0.62, "#d5b48b", "#59414a")
    : index === 4 ? figure(960, 750, 1.0, "#e0c5a0", "#6d4b80")
    : index === 5 ? figure(960, 760, 0.9, "#d6b28d", "#4b596d")
    : index === 8 ? figure(760, 790, 0.7, "#c6a17d", "#75647e") + figure(1160, 790, 0.7, "#c6a17d", "#4f5f79")
    : index === 9 ? figure(880, 780, 0.8, "#d8b68b", "#8b704e") + figure(1050, 790, 0.7, "#d8b68b", "#6d5d82")
    : figure(960, 790, 0.9, "#d9b38a", index === 1 ? "#b34c50" : "#78617f");
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">' +
    '<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + colors[0] + '"/><stop offset="1" stop-color="' + colors[1] + '"/></linearGradient><radialGradient id="light"><stop offset="0" stop-color="#ffe7a8" stop-opacity=".65"/><stop offset="1" stop-color="#ffe7a8" stop-opacity="0"/></radialGradient></defs>' +
    '<rect width="1920" height="1080" fill="url(#sky)"/><ellipse cx="' + (960 + (index % 3 - 1) * 250) + '" cy="420" rx="780" ry="570" fill="url(#light)"/>' + stars + set + figures +
    '<rect y="0" width="1920" height="1080" fill="none" stroke="#e7c88c" stroke-width="22" opacity=".35"/>' +
    '<path d="M0 70 H1920 M0 1010 H1920" stroke="#f4d9a0" stroke-width="3" opacity=".25"/>' +
    '</svg>';
}
try {
  const assets = path.join(root, "assets");
  await mkdir(assets, { recursive: true });
  for (let i = 0; i < scenes.length; i++) {
    const svg = path.join(assets, "scene-" + i + ".svg");
    const png = path.join(assets, "scene-" + i + ".png");
    await writeFile(svg, sceneSvg(i));
    await exec(process.env.RSVG_CONVERT_PATH || "rsvg-convert", ["-w", "1920", "-h", "1080", "-o", png, svg]);
  }
  const audioSegments = [];
  for (let i = 0; i < narrationLines.length; i++) {
    const raw = path.join(assets, "voice-" + i + ".wav");
    const padded = path.join(assets, "voice-padded-" + i + ".wav");
    await exec(process.env.ESPEAK_PATH || "espeak", ["-s", "148", "-p", "42", "-w", raw, narrationLines[i]]);
    await exec(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-i", raw, "-af", "apad=pad_dur=3,atrim=duration=3", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", padded]);
    audioSegments.push(padded);
  }
  const concatList = path.join(assets, "voice-list.txt");
  await writeFile(concatList, audioSegments.map(file => "file '" + file + "'").join("\n") + "\n");
  const narration = path.join(assets, "narration.wav");
  await exec(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", concatList, "-c", "copy", narration]);
  const music = path.join(assets, "music-432.wav");
  await exec(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "sine=frequency=432:sample_rate=48000:duration=30",
    "-f", "lavfi", "-i", "sine=frequency=216:sample_rate=48000:duration=30",
    "-filter_complex", "[0:a]volume=0.06[a0];[1:a]volume=0.025[a1];[a0][a1]amix=inputs=2:duration=longest,afade=t=in:st=0:d=2,afade=t=out:st=27:d=3",
    "-ac", "2", "-c:a", "pcm_s16le", music]);
  const shots = scenes.map((scene, i) => ({
    id: "joseph-shot-" + (i + 1), image: "assets/scene-" + i + ".png", durationSec: 3,
    motion: ["zoom_in", "zoom_out", "pan_left", "pan_right"][i % 4],
    visual: scene[1], narration: narrationLines[i], labels: ["scripture", "dramatization"],
    sources: ["Genesis 37-45", "synthetic-vector-artwork"],
    provenance: { classification: "unverified", source: "synthetic CI artwork", notes: "Prototype only; not for publication" }
  }));
  const result = await produceKernelVisionEpisode({
    projectId: "joseph-story-prototype", episodeId: "joseph-smoke", title: "Joseph: From the Pit to Forgiveness",
    contentDomain: "bible", passage: "Genesis 37-45", shots, narrationPath: "assets/narration.wav", musicPath: "assets/music-432.wav",
    narrationProvenance: { classification: "unverified", source: "espeak synthetic narration", notes: "Prototype only; not for publication" },
    musicProvenance: { classification: "unverified", source: "432 Hz test ambience", notes: "Prototype only; not for publication" }
  }, { mediaRoot: root, fabric: { async put(appId, id, record) { records.push({ appId, id, record }); return record; } } });
  const output = path.join(root, result.artifact.output.path);
  const subtitles = path.join(root, result.artifact.subtitles.path);
  const info = await stat(output);
  let exportedTo = null;
  if (exportDir) {
    await mkdir(exportDir, { recursive: true });
    const published = path.join(exportDir, "joseph-from-pit-to-forgiveness.mp4");
    const publishedSrt = path.join(exportDir, "joseph-from-pit-to-forgiveness.srt");
    await copyFile(output, published);
    await copyFile(subtitles, publishedSrt);
    exportedTo = exportDir;
  }
  assert.ok(info.size > 100000, "rendered MP4 must contain actual media bytes");
  assert.equal(result.artifact.status, "ready");
  assert.equal(result.artifact.output.width, 1920);
  assert.equal(result.artifact.output.height, 1080);
  assert.equal(result.artifact.output.vcodec, "h264");
  assert.equal(result.artifact.output.acodec, "aac");
  assert.ok(Math.abs(result.artifact.output.fps - 24) < 0.01, "rendered MP4 must be 24 fps");
  assert.ok(Math.abs(result.artifact.output.durationSec - 30) < 0.75);
  assert.equal(result.artifact.releaseEligible, false, "synthetic prototype must never be publication-eligible");
  assert.equal(records.length, 1);
  console.log(JSON.stringify({
    success: true, prototype: true, notForPublication: true, bytes: info.size,
    output: exportDir ? exportedTo : "ephemeral; removed after smoke", exportedTo, sha256: result.artifact.output.sha256,
    durationSec: result.artifact.output.durationSec, fps: result.artifact.output.fps,
    narration: "espeak", music: "432 Hz ambient test tone", artwork: "10 authored vector scenes",
    qc: result.artifact.quality
  }, null, 2));
} catch (error) {
  console.error("[kernelvision-episode-smoke] failed:", error?.stack || error);
  process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
}
