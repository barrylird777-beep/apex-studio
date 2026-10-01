import crypto from "node:crypto";
import { uid, now } from "./id.mjs";

export const MATURE_CATEGORIES=Object.freeze(["romance","dating","flirting","sensual","intimacy","adult","nsfw","mature-drama","mature-comedy","body-positive","fashion-editorial","boudoir-style","roleplay","relationship","passion","adult-fantasy","adult-horror","mature-themes","suggestive"]);
export const MATURE_MEDIA_TYPES=Object.freeze(["image","video","voiceover","music","script","storyboard"]);
export const MATURE_WORKSPACES=Object.freeze([
 {id:"romance",name:"Romance Studio",description:"Romantic relationships and love stories"},
 {id:"sensual",name:"Sensual Studio",description:"Suggestive and intimate creative direction"},
 {id:"adult",name:"Adult Studio",description:"Adult-oriented creative projects"},
 {id:"mature-drama",name:"Mature Drama",description:"Adult themes and relationship storytelling"},
 {id:"body-positive",name:"Body Positive",description:"Body-positive editorial and character work"},
 {id:"roleplay",name:"Roleplay Studio",description:"Adult character and scenario roleplay projects"},
 {id:"audio",name:"Voice & Audio",description:"Mature dialogue and audio production"},
 {id:"visual",name:"Visual Studio",description:"Mature image and video project controls"}
]);

function hashPasscode(passcode,salt=crypto.randomBytes(16).toString("hex")){return {salt,hash:crypto.scryptSync(String(passcode),salt,32).toString("hex")};}
function verifyPasscode(passcode,stored){const actual=Buffer.from(crypto.scryptSync(String(passcode),stored.salt,32).toString("hex"));const expected=Buffer.from(stored.hash);return actual.length===expected.length&&crypto.timingSafeEqual(actual,expected);}

export function createMaturePolicy(input={}){
 const enabled=input.enabledCategories??["romance","dating","flirting","sensual","intimacy","mature-drama","mature-comedy","body-positive","fashion-editorial","boudoir-style","roleplay","relationship","passion","mature-themes","suggestive"];
 return {enabled:Boolean(input.enabled??false),ageVerified:Boolean(input.ageVerified??false),consentConfirmed:Boolean(input.consentConfirmed??false),enabledCategories:Object.fromEntries(MATURE_CATEGORIES.map(c=>[c,enabled.includes(c)])),enabledMedia:Object.fromEntries(MATURE_MEDIA_TYPES.map(t=>[t,Boolean(input.enabledMedia?.[t]??true)])),requireProjectLabel:Boolean(input.requireProjectLabel??true),separateAssetLibrary:Boolean(input.separateAssetLibrary??true),auditEnabled:Boolean(input.auditEnabled??true),updatedAt:now()};
}

export class MatureContentManager{
 constructor(input={}){this.policy=createMaturePolicy(input.policy);this.projects=new Map();this.audit=[];this.providers=new Map();this.layers={label:"LAYERS",configured:false,locked:true,session:null};if(input.passcode)this.configurePasscode(input.passcode);}
 configurePasscode(passcode){if(String(passcode).length<6)throw new Error("Layers passcode must be at least 6 characters");const stored=hashPasscode(passcode);this.layers={label:"LAYERS",configured:true,locked:true,session:null,...stored};delete this.layers.hash;this._passcodeHash=stored.hash;this._passcodeSalt=stored.salt;this.record("layers.configured");return this.layerStatus();}
 layerStatus(){return {label:"LAYERS",configured:this.layers.configured,locked:this.layers.locked,expiresAt:this.layers.session?.expiresAt??null};}
 unlock(passcode,ttlMs=30*60*1000){if(!this.layers.configured||!this._passcodeHash)throw new Error("Layers passcode is not configured");const ok=verifyPasscode(passcode,{salt:this._passcodeSalt,hash:this._passcodeHash});if(!ok){this.record("layers.unlock.failed");throw new Error("Invalid Layers passcode");}const token=crypto.randomBytes(24).toString("hex");this.layers.session={token,expiresAt:Date.now()+Math.max(60_000,Math.min(Number(ttlMs)||30*60*1000,24*60*60*1000))};this.layers.locked=false;this.record("layers.unlocked");return {token,expiresAt:this.layers.session.expiresAt};}
 lock(token){if(token&&this.layers.session?.token!==token)throw new Error("Invalid Layers session");this.layers.session=null;this.layers.locked=true;this.record("layers.locked");return this.layerStatus();}
 isUnlocked(token){const s=this.layers.session;if(!s||s.token!==token)return false;if(Date.now()>s.expiresAt){this.lock(token);return false;}return true;}
 status(token){return {...this.layerStatus(),unlocked:this.isUnlocked(token)};}
 requireUnlocked(token){if(!this.isUnlocked(token))throw new Error("Layers is locked");return true;}
 status(){return {policy:{...this.policy,enabledCategories:{...this.policy.enabledCategories},enabledMedia:{...this.policy.enabledMedia}},categories:MATURE_WORKSPACES,projectCount:this.projects.size,providers:[...this.providers.values()],auditCount:this.audit.length};}
 updatePolicy(input={}){this.policy=createMaturePolicy({...this.policy,...input,enabledCategories:input.enabledCategories??MATURE_CATEGORIES.filter(c=>this.policy.enabledCategories[c]),enabledMedia:{...this.policy.enabledMedia,...input.enabledMedia}});this.record("policy.updated");return this.status();}
 setCategory(category,enabled){if(!MATURE_CATEGORIES.includes(category))throw new Error("Unknown mature category: "+category);this.policy.enabledCategories[category]=Boolean(enabled);this.record("category.updated",{category,enabled:Boolean(enabled)});return this.status();}
 setMediaType(mediaType,enabled){if(!MATURE_MEDIA_TYPES.includes(mediaType))throw new Error("Unknown media type: "+mediaType);this.policy.enabledMedia[mediaType]=Boolean(enabled);this.record("media.updated",{mediaType,enabled:Boolean(enabled)});return this.status();}
 setProject(input={}){if(!input.projectId)throw new Error("projectId is required");const categories=(input.categories??["romance"]).filter(c=>MATURE_CATEGORIES.includes(c));const project={projectId:input.projectId,label:input.label??"mature",categories,enabled:Boolean(input.enabled??true),media:Object.fromEntries(MATURE_MEDIA_TYPES.map(t=>[t,Boolean(input.media?.[t]??true)])),updatedAt:now()};this.projects.set(project.projectId,project);this.record("project.updated",{projectId:project.projectId});return project;}
 canAccess({projectId=null,mediaType=null,category="adult"}={}){const p=this.policy,project=projectId?this.projects.get(projectId):null;const allowed=Boolean(p.enabled&&p.ageVerified&&p.consentConfirmed&&p.enabledCategories[category]===true&&(!mediaType||p.enabledMedia[mediaType]===true)&&(!project||project.enabled)&&(!project||project.categories.includes(category))&&(!mediaType||!project||project.media[mediaType]===true));let reason="ok";if(!p.enabled)reason="mature workspace disabled";else if(!p.ageVerified)reason="age verification required";else if(!p.consentConfirmed)reason="consent confirmation required";else if(!p.enabledCategories[category])reason="category disabled";else if(mediaType&&!p.enabledMedia[mediaType])reason="media type disabled";else if(project&&!project.enabled)reason="project access disabled";else if(project&&!project.categories.includes(category))reason="category not enabled for project";else if(mediaType&&project&&!project.media[mediaType])reason="media access disabled for project";return {allowed,reason};}
 record(action,input={}){const event={id:uid("mature-audit"),action,...input,at:now()};if(this.policy.auditEnabled)this.audit.push(event);return event;}
 listAudit(){return [...this.audit];}
 snapshot(){return {policy:this.policy,projects:[...this.projects.values()],providers:[...this.providers.values()],audit:this.audit,layers:this.layerStatus()};}
 restore(snapshot={}){if(snapshot.policy)this.policy=createMaturePolicy(snapshot.policy);for(const p of snapshot.projects??[])this.projects.set(p.projectId,p);for(const p of snapshot.providers??[])this.providers.set(p.id,p);this.audit=[...(snapshot.audit??[])];return this;}
}