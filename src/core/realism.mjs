import { uid, now } from "./id.mjs";

export const REALISM_MODES=Object.freeze([
  "photorealistic",
  "cinematic-real",
  "documentary-real",
  "naturalistic",
  "hyper-detailed"
]);

export const REALISM_MEDIA=Object.freeze(["image","video","storyboard","script","voiceover"]);

const DEFAULT_REALISM=Object.freeze({
  mode:"photorealistic",
  identityConsistency:true,
  anatomyConsistency:true,
  naturalSkinTexture:true,
  naturalHairAndFabric:true,
  realisticEyes:true,
  realisticHands:true,
  realisticMaterials:true,
  physicallyPlausibleLighting:true,
  physicallyPlausibleMotion:true,
  naturalDepthOfField:true,
  lensCharacteristics:true,
  environmentalDetail:true,
  ageAppropriateAppearance:true,
  syntheticDisclosure:true
});

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
function choice(list,value,label){if(!list.includes(value))throw new Error(`Unknown ${label}: ${value}`);}

export function createRealismProfile(input={}){
  const mode=input.mode??DEFAULT_REALISM.mode;
  choice(REALISM_MODES,mode,"realism mode");
  return {
    id:input.id??uid("realism"),
    label:input.label??"real-life realism",
    mode,
    media:[...(input.media??REALISM_MEDIA)].filter(m=>REALISM_MEDIA.includes(m)),
    identityConsistency:Boolean(input.identityConsistency??DEFAULT_REALISM.identityConsistency),
    anatomyConsistency:Boolean(input.anatomyConsistency??DEFAULT_REALISM.anatomyConsistency),
    naturalSkinTexture:Boolean(input.naturalSkinTexture??DEFAULT_REALISM.naturalSkinTexture),
    naturalHairAndFabric:Boolean(input.naturalHairAndFabric??DEFAULT_REALISM.naturalHairAndFabric),
    realisticEyes:Boolean(input.realisticEyes??DEFAULT_REALISM.realisticEyes),
    realisticHands:Boolean(input.realisticHands??DEFAULT_REALISM.realisticHands),
    realisticMaterials:Boolean(input.realisticMaterials??DEFAULT_REALISM.realisticMaterials),
    physicallyPlausibleLighting:Boolean(input.physicallyPlausibleLighting??DEFAULT_REALISM.physicallyPlausibleLighting),
    physicallyPlausibleMotion:Boolean(input.physicallyPlausibleMotion??DEFAULT_REALISM.physicallyPlausibleMotion),
    naturalDepthOfField:Boolean(input.naturalDepthOfField??DEFAULT_REALISM.naturalDepthOfField),
    lensCharacteristics:Boolean(input.lensCharacteristics??DEFAULT_REALISM.lensCharacteristics),
    environmentalDetail:Boolean(input.environmentalDetail??DEFAULT_REALISM.environmentalDetail),
    ageAppropriateAppearance:Boolean(input.ageAppropriateAppearance??DEFAULT_REALISM.ageAppropriateAppearance),
    syntheticDisclosure:Boolean(input.syntheticDisclosure??DEFAULT_REALISM.syntheticDisclosure),
    visualAnchors:clone(input.visualAnchors??{}),
    negativeConstraints:[...(input.negativeConstraints??[])],
    createdAt:input.createdAt??now(),
    updatedAt:now()
  };
}

export class RealismManager{
  constructor(){this.profiles=new Map();}

  create(input={}){const p=createRealismProfile(input);this.profiles.set(p.id,p);return p;}
  get(id){return this.profiles.get(id)??null;}
  list(){return [...this.profiles.values()];}

  update(id,input={}){
    const current=this.require(id);
    const next=createRealismProfile({...current,...input,id:current.id});
    this.profiles.set(id,next);
    return next;
  }

  promptSpec(id){
    const p=this.require(id);
    const positives=[
      p.mode,
      "real-life visual detail",
      p.naturalSkinTexture&&"natural skin texture",
      p.naturalHairAndFabric&&"individual hair and physically plausible fabric",
      p.realisticEyes&&"natural eye reflections",
      p.realisticHands&&"accurate hands and fingers",
      p.realisticMaterials&&"physically plausible materials",
      p.physicallyPlausibleLighting&&"physically plausible lighting",
      p.physicallyPlausibleMotion&&"physically plausible motion",
      p.naturalDepthOfField&&"natural depth of field",
      p.lensCharacteristics&&"realistic lens characteristics",
      p.environmentalDetail&&"high-fidelity environmental detail"
    ].filter(Boolean);
    return {
      mode:p.mode,
      positives,
      negativeConstraints:[...p.negativeConstraints],
      continuity:p.identityConsistency,
      disclosure:p.syntheticDisclosure
    };
  }

  applyToAsset(asset={},profileId){
    const p=this.require(profileId);
    return {
      ...asset,
      realism:{profileId:p.id,mode:p.mode,continuity:p.identityConsistency,promptSpec:this.promptSpec(p.id),updatedAt:now()}
    };
  }

  require(id){const p=this.get(id);if(!p)throw new Error("Realism profile not found");return p;}
  snapshot(){return {profiles:this.list()};}
  restore(snapshot={}){for(const p of snapshot.profiles??[])this.profiles.set(p.id,p);return this;}
}
