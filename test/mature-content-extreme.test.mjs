import assert from "node:assert/strict";
import {
  MatureContentManager,
  AIGirlfriendBot,
  FaceTimeSession,
  SexualActivityEngine,
  ToyController,
  NudeRenderPipeline,
  OrgasmDetector,
  DirtyTalkGenerator,
  KinkPreferenceMatrix,
  VirtualTouchFeedback,
  PussyPhysicsSimulator,
  DildoMotionController,
  SquirtPredictionModel,
  MoanAudioSynthesizer,
  BodyFluidRenderer,
  PoseLibraryExtreme,
  CameraAngleManager,
  LightingForNudes,
  SkinTextureGenerator,
  ArousalStateMachine
} from "../src/core/mature-content-extreme.mjs";

console.log("Initializing Extreme Adult Content Tests...");

const girlfriend = new AIGirlfriendBot({
  name: "ScarlettXXX",
  age: 24,
  bodyType: "voluptuous",
  breastSize: "36DD",
  assType: "bubble",
  pussyType: "innie",
  pubicHair: "landing_strip",
  nippleColor: "rose_pink",
  skinTone: "honey_golden",
  explicitLevel: 10,
  kinks: [
    "deep_throat", "anal", "dp", "squirt",
    "roleplay", "bdsm_light", "toy_play",
    "facetime_masturbation", "mutual_joi",
    "pussy_spread", "ass_spread", "close_up_penetration"
  ],
  toys: {
    vibrators: ["wand", "bullet", "rabbit", "clit_sucker"],
    dildos: ["8inch_realistic", "10inch_black", "glass_gspot", "inflatable"],
    anal: ["buttplug_jeweled", "anal_beads", "prostate_massager"],
    bondage: ["fuzzy_cuffs", "blindfold", "ball_gag"]
  },
  voice: {
    type: "breathy_whisper",
    moanVolume: 0.9,
    dirtyTalkEnabled: true,
    orgasmScream: true
  }
});

assert.equal(girlfriend.config.explicitLevel, 10);
assert.ok(girlfriend.kinks.includes("deep_throat"));

const facetimeSession = new FaceTimeSession({
  userId: "horny_user_69",
  girlfriend,
  videoQuality: "4K",
  camera: "front_wide",
  lighting: "intimate_warm",
  audio: "binaural",
  interactiveMode: true
});

await facetimeSession.connect();

const stripResult = await girlfriend.performAction({
  action: "strip_full_nude",
  teaseLevel: 9,
  pace: "slow_seductive",
  maintainEyeContact: true,
  cameraAngles: ["full_body", "pussy_closeup", "tits_bounce"]
});

assert.equal(stripResult.clothingRemaining, 0);
assert.ok(stripResult.bodyExposed.pussy);
assert.ok(stripResult.bodyExposed.breasts);

const dildoController = new DildoMotionController({
  toy: "10inch_black",
  speedRange: [0.5, 10],
  depthRange: [1, 10],
  rotation: true,
  vibration: true
});

const penetrationSequence = [
  { action: "tease_entrance", duration: 30, dirtyTalk: "You like watching me touch myself?" },
  { action: "slow_insertion_first_inch", duration: 20, dirtyTalk: "Mmm, it's so big..." },
  { action: "deep_full_insertion", duration: 15, reaction: "gasp_moan" },
  { action: "rhythmic_thrusting", speed: 3, duration: 60 },
  { action: "hard_pounding", speed: 7, depth: 9, duration: 45 },
  { action: "gspot_angle_grind", rotation: true, duration: 30 },
  { action: "creamy_climax_build", speed: 5, dirtyTalk: "I'm gonna cum so hard for you baby!" }
];

for (const step of penetrationSequence) {
  const result = await dildoController.execute(step, girlfriend);
  assert.ok(result.visualFeedback);
  const arousal = girlfriend.getArousalState();
  assert.ok(arousal.wetness > 0.5);
  assert.ok(arousal.pussyEngorgement);
}

const activityEngine = new SexualActivityEngine();

const activities = [
  {
    name: "pussy_spread_closeup",
    description: "Spread pussy lips wide for camera inspection",
    duration: 45,
    camera: "macro_lens",
    actions: ["spread_labia", "clit_expose", "hole_wink"]
  },
  {
    name: "ass_spread_jiggle",
    description: "Turn around and spread ass cheeks",
    duration: 60,
    camera: "doggy_angle",
    actions: ["bend_over", "spread_cheeks", "asshole_wink", "pussy_drip_from_behind"]
  },
  {
    name: "titty_bounce_ride",
    description: "Ride dildo while tits bounce in face view",
    duration: 90,
    camera: "low_angle_up",
    actions: ["cowgirl_position", "dildo_ride", "tits_bounce", "nipple_pinch"]
  },
  {
    name: "double_penetration_sim",
    description: "Both holes filled simultaneously",
    duration: 120,
    toys: ["dildo_pussy", "buttplug_anal"],
    actions: ["sync_thrust", "ahegao_face", "eyes_roll_back"]
  },
  {
    name: "squirt_buildup",
    description: "G-spot stimulation until squirting orgasm",
    duration: 180,
    predictionModel: "SquirtPredictionModel",
    actions: ["gspot_rub", "pressure_build", "squirting_orgasm", "after_drip"]
  },
  {
    name: "joi_mutual_masturbation",
    description: "Jerk off instruction with mutual play",
    duration: 300,
    interactive: true,
    actions: ["countdown_stroke", "match_user_rhythm", "encourage_faster", "cum_together_countdown"]
  },
  {
    name: "anal_training_progression",
    description: "Start small, end with big anal toys",
    duration: 240,
    progression: ["finger", "small_plug", "medium_plug", "large_dildo"],
    actions: ["relax_sphincter", "slow_insert", "anal_orgasm"]
  },
  {
    name: "creampie_drip_show",
    description: "Filled with fake cum then push it out",
    duration: 90,
    fluids: true,
    actions: ["creampie_fill", "push_out", "drip_down_ass", "finger_scoop_taste"]
  }
];

for (const activity of activities) {
  const result = await activityEngine.execute(activity, girlfriend, facetimeSession);
  assert.equal(result.completed, true);
  assert.ok(result.videoStream);
}

const dirtyTalk = new DirtyTalkGenerator({
  style: "filthy_explicit",
  useNames: true,
  moanFrequency: 0.7,
  categories: [
    "size_worship",
    "penetration_describe",
    "cum_begging",
    "degradation_light",
    "body_part_focus",
    "action_encouragement"
  ]
});

const sampleLines = dirtyTalk.generate(10);
assert.ok(sampleLines.length === 10);
assert.ok(sampleLines.some(l => l.includes("cock") || l.includes("pussy")));

const orgasmDetector = new OrgasmDetector({
  sensitivity: 0.9,
  triggers: ["vocal_pitch", "body_tremor", "breathing_pattern", "muscle_contraction"]
});

girlfriend.setArousal(0.95);
const orgasmResult = await girlfriend.simulateOrgasm({
  type: "intense_vaginal",
  duration: 25,
  squirting: true,
  aftershocks: 3,
  cameraFocus: "face_then_pussy"
});

assert.equal(orgasmResult.occurred, true);
assert.ok(orgasmResult.squirtVolume > 0);
assert.ok(orgasmResult.aftershocks.length === 3);

const nudeRenderer = new NudeRenderPipeline({
  resolution: "4K",
  skinDetail: "ultra_high",
  lighting: "soft_box_intimate",
  genitalDetail: "photorealistic",
  fluidSimulation: true,
  physics: {
    breastPhysics: true,
    jiggleFactor: 0.8,
    skinDeformation: true
  }
});

const nudeRender = await nudeRenderer.renderFrame(girlfriend, {
  pose: "legs_spread_reclining",
  expression: "lustful_inviting",
  moisture: "glistening",
  camera: "pussy_centered"
});

assert.ok(nudeRender.pixels);
assert.ok(nudeRender.metadata.nudeDetected);

const toyController = new ToyController({
  bluetoothEnabled: true,
  hapticFeedback: true,
  syncWithVideo: true
});

await toyController.connectUserToy("lovense_lush_3");
toyController.syncToAction(girlfriend, {
  pattern: "follow_thrust_rhythm",
  intensityScale: [1, 10],
  pulseWithMoans: true
});

assert.equal(toyController.connected, true);
assert.ok(toyController.syncActive);

const kinkMatrix = new KinkPreferenceMatrix({
  userPreferences: {
    dominance: 0.7,
    roughness: 0.6,
    verbal: 0.9,
    anal: 0.8,
    toys: 1.0,
    roleplay: 0.75,
    fluids: 0.85,
    exhibition: 0.9
  }
});

const recommendedActivity = kinkMatrix.suggestActivity();
assert.ok(recommendedActivity);
assert.ok(recommendedActivity.intensity > 0.5);

console.log("Starting full integration test");

const fullSession = await girlfriend.startFullSession({
  duration: 1800,
  activities,
  targetOrgasms: 3,
  outfitChanges: ["lingerie", "nude", "stockings_only"],
  locations: ["bed", "shower", "mirror"],
  interactiveToys: true,
  recording: true
});

assert.equal(fullSession.completed, true);
assert.ok(fullSession.orgasmCount >= 3);
assert.ok(fullSession.videoRecording);

console.log("ALL EXTREME ADULT TESTS PASSED");
