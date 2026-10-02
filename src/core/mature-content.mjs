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
 configurePasscode(passcode){if(this.layers.configured)throw new Error("Layers passcode is already configured");if(String(passcode).length<6)throw new Error("Layers passcode must be at least 6 characters");const stored=hashPasscode(passcode);this.layers={label:"LAYERS",configured:true,locked:true,session:null,...stored};delete this.layers.hash;this._passcodeHash=stored.hash;this._passcodeSalt=stored.salt;this.record("layers.configured");return this.layerStatus();}
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

// src/core/mature-content.mjs

export class MatureContentManager {
  constructor() {
    this.isExplicitMode = false;
    this.explicitUIElements = [];
    this.init();
  }

  init() {
    // Create explicit UI theme
    this.createExplicitUITheme();
    
    // Add explicit styles to document
    this.addExplicitStyles();
  }

  createExplicitUITheme() {
    // Create explicit background with titties
    this.createExplicitBackground();
    
    // Add explicit UI elements
    this.addExplicitUIElements();
    
    // Initialize interactive features
    this.initInteractiveFeatures();
  }

  createExplicitBackground() {
    const backgroundContainer = document.createElement('div');
    backgroundContainer.className = 'explicit-background-container';
    
    // Create titty pattern
    for (let i = 0; i < 30; i++) {
      const tittyElement = document.createElement('div');
      tittyElement.className = 'titty-element';
      
      // Random positioning
      const size = Math.random() * 80 + 40;
      tittyElement.style.width = `${size}px`;
      tittyElement.style.height = `${size}px`;
      tittyElement.style.left = `${Math.random() * 100}%`;
      tittyElement.style.top = `${Math.random() * 100}%`;
      tittyElement.style.opacity = `\${Math.random() * 0.5 + 0.3}`;
      
      // Add animation
      tittyElement.style.animation = `float \${Math.random() * 10 + 5}s infinite linear`;
      
      backgroundContainer.appendChild(tittyElement);
    }
    
    // Create pussy elements
    for (let i = 0; i < 20; i++) {
      const pussyElement = document.createElement('div');
      pussyElement.className = 'pussy-element';
      
      // Random positioning
      const size = Math.random() * 60 + 30;
      pussyElement.style.width = `${size}px`;
      pussyElement.style.height = `${size * 0.6}px`;
      pussyElement.style.left = `${Math.random() * 100}%`;
      pussyElement.style.top = `${Math.random() * 100}%`;
      pussyElement.style.opacity = `\${Math.random() * 0.4 + 0.2}`;
      
      // Add animation
      pussyElement.style.animation = `pulse \${Math.random() * 5 + 3}s infinite alternate`;
      
      backgroundContainer.appendChild(pussyElement);
    }
    
    // Add to body
    document.body.appendChild(backgroundContainer);
    this.explicitUIElements.push(backgroundContainer);
  }

  addExplicitUIElements() {
    // Find all buttons and replace with explicit ones
    const buttons = document.querySelectorAll('button, .btn');
    
    buttons.forEach(button => {
      // Create explicit button wrapper
      const explicitButton = document.createElement('div');
      explicitButton.className = 'explicit-button-wrapper';
      
      // Create titty decoration
      const tittyDecoration = document.createElement('div');
      tittyDecoration.className = 'titty-decoration';
      
      // Create pussy decoration
      const pussyDecoration = document.createElement('div');
      pussyDecoration.className = 'pussy-decoration';
      
      // Replace button content
      button.innerHTML = '';
      button.appendChild(tittyDecoration);
      button.appendChild(pussyDecoration);
      
      // Add explicit styling
      button.classList.add('explicit-button');
      
      // Add hover effects
      button.addEventListener('mouseenter', () => {
        this.createExplicitHoverEffect(button);
      });
    });
    
    // Add explicit elements to other UI components
    this.addExplicitElementsToPanels();
  }

  addExplicitElementsToPanels() {
    // Find all panels and containers
    const panels = document.querySelectorAll('.panel, .container, .card');
    
    panels.forEach(panel => {
      // Create explicit border decorations
      const borderDecoration = document.createElement('div');
      borderDecoration.className = 'explicit-border-decoration';
      
      // Add titties to corners
      for (let i = 0; i < 4; i++) {
        const cornerTitty = document.createElement('div');
        cornerTitty.className = 'corner-titty';
        cornerTitty.style.position = 'absolute';
        cornerTitty.style.width = '30px';
        cornerTitty.style.height = '30px';
        
        // Position at corners
        const positions = ['top: 0; left: 0;', 'top: 0; right: 0;', 'bottom: 0; left: 0;', 'bottom: 0; right: 0;'];
        cornerTitty.style.cssText = positions[i];
        
        borderDecoration.appendChild(cornerTitty);
      }
      
      // Add pussy elements to edges
      for (let i = 0; i < 8; i++) {
        const edgePussy = document.createElement('div');
        edgePussy.className = 'edge-pussy';
        edgePussy.style.position = 'absolute';
        edgePussy.style.width = '20px';
        edgePussy.style.height = '15px';
        
        // Position at edges
        const positions = [
          'top: 10px; left: 40%;', 'top: 10px; left: 60%;',
          'right: 10px; top: 40%;', 'right: 10px; top: 60%;',
          'bottom: 10px; left: 40%;', 'bottom: 10px; left: 60%;',
          'left: 10px; top: 40%;', 'left: 10px; top: 60%;'
        ];
        edgePussy.style.cssText = positions[i];
        
        borderDecoration.appendChild(edgePussy);
      }
      
      // Add to panel
      panel.style.position = 'relative';
      panel.appendChild(borderDecoration);
    });
  }

  initInteractiveFeatures() {
    // Add click events to explicit elements
    document.addEventListener('click', (event) => {
      if (event.target.classList.contains('titty-element') || 
          event.target.classList.contains('pussy-element')) {
        this.createExplicitClickEffect(event.target);
      }
    });
  }

  createExplicitHoverEffect(element) {
    // Create sparkle effect
    const sparkleContainer = document.createElement('div');
    sparkleContainer.className = 'sparkle-container';
    
    for (let i = 0; i < 15; i++) {
      const sparkle = document.createElement('div');
      sparkle.className = 'sparkle';
      sparkle.style.left = `${Math.random() * 100}%`;
      sparkle.style.top = `${Math.random() * 100}%`;
      sparkle.style.animationDelay = `\${Math.random() * 0.5}s`;
      sparkleContainer.appendChild(sparkle);
    }
    
    element.appendChild(sparkleContainer);
    
    // Remove after animation
    setTimeout(() => {
      if (sparkleContainer.parentNode) {
        sparkleContainer.parentNode.removeChild(sparkleContainer);
      }
    }, 2000);
  }

  createExplicitClickEffect(element) {
    // Create pulsing effect
    const pulse = document.createElement('div');
    pulse.className = 'explicit-pulse';
    pulse.style.position = 'absolute';
    pulse.style.width = '100%';
    pulse.style.height = '100%';
    pulse.style.top = '0';
    pulse.style.left = '0';
    pulse.style.background = 'radial-gradient(circle, rgba(255,105,180,0.8) 0%, rgba(255,105,180,0) 70%)';
    pulse.style.transform = 'scale(0)';
    pulse.style.animation = 'pulse 0.5s ease-out';
    
    element.appendChild(pulse);
    
    // Remove after animation
    setTimeout(() => {
      if (pulse.parentNode) {
        pulse.parentNode.removeChild(pulse);
      }
    }, 500);
  }

  addExplicitStyles() {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes float {
        0% { transform: translateY(0) rotate(0deg); opacity: 0.7; }
        50% { transform: translateY(-20px) rotate(180deg); opacity: 0.9; }
        100% { transform: translateY(-40px) rotate(360deg); opacity: 0.7; }
      }
      
      @keyframes pulse {
        0% { transform: scale(0); opacity: 1; }
        100% { transform: scale(1); opacity: 0; }
      }
      
      .explicit-background-container {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: -1;
        pointer-events: none;
      }
      
      .titty-element, .pussy-element {
        position: absolute;
        background-size: contain;
        background-repeat: no-repeat;
        background-position: center;
        pointer-events: auto;
        cursor: pointer;
      }
      
      .titty-element {
        background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="%23FF69B4"/><circle cx="35" cy="45" r="8" fill="%23FF1493"/><circle cx="65" cy="45" r="8" fill="%23FF1493"/></svg>');
     
