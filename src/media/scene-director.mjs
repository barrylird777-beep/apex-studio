import { buildVisualPrompt, hashPrompt } from "./prompt-builder.mjs";

const SEQUENCES = Object.freeze({
  "azazel-michael": [
    {
      id: "azazel-forge",
      durationSeconds: 3,
      subject: "Azazel in shadow-black armor, imposing fallen-warrior silhouette, scarred obsidian plating",
      action: "forging brutal weapons beside primitive humanity, sparks exploding from an ancient forge",
      environment: "primeval stone settlement, smoke, firelight, crude tools, storm-dark horizon",
      camera: "low-angle 35mm tracking shot, foreground sparks crossing frame",
      lighting: "forge-orange underlight against black-blue backlight",
      palette: ["obsidian black", "charcoal", "ember orange", "iron red"]
    },
    {
      id: "azazel-rise",
      durationSeconds: 3,
      subject: "Azazel fully armored in shadow-black plate",
      action: "turning from the forge toward a distant celestial presence, weapon raised",
      environment: "ruined primeval valley, ash and smoke drifting through monumental stone",
      camera: "slow push-in from wide establishing shot to heroic close medium",
      lighting: "hard rim light, ember bounce, near-black shadow mass",
      palette: ["obsidian", "smoke gray", "ember orange", "blood crimson"]
    },
    {
      id: "michael-descent",
      durationSeconds: 3,
      subject: "Michael in radiant gold celestial armor, disciplined angelic warrior",
      action: "descending through storm clouds with sword drawn, confronting Azazel",
      environment: "vast storm-black sky splitting around a vertical shaft of celestial light",
      camera: "high-angle descent transitioning into symmetrical frontal composition",
      lighting: "blinding warm-gold key light, white-hot highlights, deep blue shadows",
      palette: ["radiant gold", "white", "sapphire blue", "black"]
    },
    {
      id: "michael-counterstrike",
      durationSeconds: 3,
      subject: "Michael in radiant gold plating facing Azazel's shadow-black armor",
      action: "launching a decisive counter-strike, golden blade colliding with Azazel's weapon",
      environment: "shattered stone battlefield, airborne debris, expanding shockwave",
      camera: "dynamic Dutch angle, 50mm impact close-up, motion frozen at collision",
      lighting: "gold-white impact flash against abyssal black, sharp volumetric beams",
      palette: ["radiant gold", "obsidian black", "white-hot", "deep violet"]
    },
    {
      id: "final-standoff",
      durationSeconds: 3,
      subject: "Azazel black-armored silhouette and Michael gold-armored silhouette",
      action: "standing opposed after the impact, weapons lowered but tension unresolved",
      environment: "burning primeval landscape beneath a split celestial sky",
      camera: "ultra-wide symmetrical 24mm composition with strong depth layers",
      lighting: "split lighting: cold darkness around Azazel, warm celestial glow around Michael",
      palette: ["obsidian", "radiant gold", "ash gray", "deep blue"]
    }
  ]
});

export class SceneDirector {
  constructor({ sequences = SEQUENCES } = {}) {
    this.sequences = sequences;
  }

  buildSequence(name = "azazel-michael", { durationScale = 1 } = {}) {
    const key = String(name).trim().toLowerCase();
    const source = this.sequences[key];
    if (!source) throw new Error(`Unknown scene sequence: ${key}`);
    const scale = Math.min(10, Math.max(0.25, Number(durationScale) || 1));
    return source.map((scene, index) => {
      const prompt = buildVisualPrompt(scene);
      return {
        ...scene,
        index,
        durationSeconds: Number((scene.durationSeconds * scale).toFixed(3)),
        prompt,
        promptSha256: hashPrompt(prompt)
      };
    });
  }

  storyboard(name = "azazel-michael", options = {}) {
    const scenes = this.buildSequence(name, options);
    return {
      sequence: String(name).trim().toLowerCase(),
      fps: 24,
      aspectRatio: "16:9",
      totalDurationSeconds: Number(scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0).toFixed(3)),
      scenes
    };
  }
}

export default SceneDirector;
