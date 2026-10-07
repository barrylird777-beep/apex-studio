import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { appendEvent, paths } from './sovereign-local-storage.mjs';

const now = () => Date.now();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export const CAPABILITIES = Object.freeze([
  'script','reasoning','coding','research','image','video','audio','embedding',
  'render','encode','decode','vector','storage','network','arbitration'
]);

const modelCatalog = Object.freeze([
  { id:'hf-flux', provider:'huggingface', model:process.env.HF_FLUX_MODEL || 'black-forest-labs/FLUX.1-schnell', capabilities:['image'], quantized:false },
  { id:'hf-realvisxl', provider:'huggingface', model:process.env.HF_REALVISXL_MODEL || 'SG161222/RealVisXL_V5.0', capabilities:['image'], quantized:false },
  { id:'local-quantized', provider:'ollama', model:process.env.OLLAMA_MODEL || 'configured', capabilities:['script','reasoning','coding','embedding'], quantized:true }
]);

const providerCatalog = Object.freeze([
  { id:'groq', env:'GROQ_API_KEY', capabilities:['script','reasoning','coding','audio'] },
  { id:'openrouter', env:'OPENROUTER_API_KEY', capabilities:['script','reasoning','coding','research','image','audio'] },
  { id:'pollinations', env:null, capabilities:['script','image','video'] },
  { id:'huggingface', env:'HF_TOKEN', capabilities:['script','image','video','audio','embedding'] },
  { id:'ollama', env:null, capabilities:['script','reasoning','coding','embedding'] },
  { id:'gemini', env:'GEMINI_API_KEY', capabilities:['script','reasoning','coding','research','image','video','audio','embedding'] },
  { id:'claude', env:'ANTHROPIC_API_KEY', capabilities:['script','reasoning','coding','research'] }
]);

export class ApexCapabilityFabric {
  constructor({ nodeId = process.env.APEX_NODE_ID || os.hostname(), cacheLimit = 2048 } = {}) {
    this.nodeId = nodeId;
    this.cacheLimit = Math.max(64, Number(cacheLimit));
    this.nodes = new Map();
    this.cache = new Map();
    this.jobs = new Map();
    this.providers = new Map(providerCatalog.map(p => [p.id, {
      ...p,
      configured: !p.env || Boolean(process.env[p.env])
    }]));
    this.models = new Map(modelCatalog.map(m => [m.id, {
      ...m,
      configured: Boolean(this.providers.get(m.provider)?.configured)
    }]));
    this.registerNode(nodeId, {
      classes:['cpu'],
      capabilities:['script','reasoning','coding','render','encode','decode','vector','storage','network'],
      capacity:{ cpu:os.availableParallelism?.() || os.cpus().length, memoryBytes:os.totalmem() }
    });
  }

  registerNode(id, resources = {}) {
    const node = {
      id,
      resources,
      online:true,
      lastSeen:now(),
      load:Number(resources.load || 0),
      score:Number(resources.score || 1)
    };
    this.nodes.set(id, node);
    return node;
  }

  heartbeat(id, patch = {}) {
    const node = this.nodes.get(id) || this.registerNode(id, patch);
    Object.assign(node, patch, { online:true, lastSeen:now() });
    return node;
  }

  expireNodes(maxAgeMs = 30000) {
    const cutoff = now() - Math.max(1000, maxAgeMs);
    for (const node of this.nodes.values()) if (node.lastSeen < cutoff) node.online = false;
  }

  availableProviders(capability) {
    return [...this.providers.values()]
      .filter(p => p.configured && p.capabilities.includes(capability))
      .map(({id,capabilities}) => ({id,capabilities}));
  }

  selectExecutor(requirements = {}) {
    this.expireNodes();
    const capability = requirements.capability || 'script';
    const candidates = [...this.nodes.values()]
      .filter(n => n.online && (!requirements.nodeClass || n.resources.classes?.includes(requirements.nodeClass)))
      .filter(n => !requirements.capability || n.resources.capabilities?.includes(capability))
      .map(n => ({
        ...n,
        effectiveScore:(n.score || 1) * (1 / Math.max(0.01, 1 + n.load))
      }))
      .sort((a,b) => b.effectiveScore - a.effectiveScore);
    return candidates[0] || null;
  }

  cacheGet(key) {
    const entry = this.cache.get(key);
    if (!entry || entry.expiresAt <= now()) {
      this.cache.delete(key);
      return null;
    }
    entry.hits++;
    entry.lastHit=now();
    return entry.value;
  }

  cacheSet(key, value, ttlMs = 3600000) {
    if (this.cache.size >= this.cacheLimit) {
      const oldest=[...this.cache.entries()].sort((a,b)=>a[1].lastHit-b[1].lastHit)[0];
      if (oldest) this.cache.delete(oldest[0]);
    }
    this.cache.set(key,{value,expiresAt:now()+Math.max(1000,ttlMs),lastHit:now(),hits:0});
    return value;
  }

  cacheKey(operation, payload) {
    return hash({operation,payload});
  }

  async submit(operation, payload = {}, options = {}) {
    const key=this.cacheKey(operation,payload);
    if (options.cache !== false) {
      const cached=this.cacheGet(key);
      if (cached !== null) return {...cached,cached:true};
    }
    const id=randomUUID();
    const job={
      id,operation,payload,
      capability:options.capability || operation,
      createdAt:new Date().toISOString(),
      state:'accepted',
      executor:this.selectExecutor({capability:options.capability || operation})?.id || this.nodeId,
      providers:this.availableProviders(options.capability || operation)
    };
    this.jobs.set(id,job);
    await appendEvent('capability.accepted',job,{id,stream:'capabilities'});
    if (options.cache !== false) this.cacheSet(key,job,options.ttlMs);
    return job;
  }

  status() {
    this.expireNodes();
    return {
      nodeId:this.nodeId,
      root:paths.ROOT,
      capabilities:CAPABILITIES,
      nodes:[...this.nodes.values()],
      providers:[...this.providers.values()].map(({env,...p})=>p),
      cache:{entries:this.cache.size,limit:this.cacheLimit},
      jobs:{accepted:this.jobs.size}
    };
  }
}
