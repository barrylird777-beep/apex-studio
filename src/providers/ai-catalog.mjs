const envConfigured = (name) => Boolean(process.env[name]);

export const AI_CATALOG = [
  { id:'openai', name:'OpenAI', class:'frontier', modalities:['chat','reasoning','coding','vision','image','audio','realtime','transcription','embeddings','agents','research'], key:'OPENAI_API_KEY', maxModel:process.env.OPENAI_MAX_MODEL || 'gpt-5.6-sol', maxSettings:{reasoning:'max',verbosity:'high'} },
  { id:'anthropic', name:'Anthropic Claude', class:'frontier', modalities:['chat','reasoning','coding','vision','agents'], key:'ANTHROPIC_API_KEY', maxModel:process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-opus-5', maxSettings:{thinking:'maximum'} },
  { id:'google', name:'Google Gemini', class:'frontier', modalities:['chat','reasoning','coding','vision','audio','image','video','tts','transcription','embeddings','agents','research'], key:'GEMINI_API_KEY', alternateKeys:['GOOGLE_API_KEY'], maxModel:process.env.GEMINI_MODEL || 'gemini-3.8-flash', maxSettings:{thinking:'maximum'} },
  { id:'xai', name:'xAI Grok', class:'frontier', modalities:['chat','reasoning','coding','vision','image','video','voice','web-search','x-search','agents'], key:'XAI_API_KEY', maxModel:process.env.GROK_MODEL || 'grok-4.7', maxSettings:{reasoning:'high',webSearch:true,xSearch:true} },
  { id:'mistral', name:'Mistral', class:'frontier-open', modalities:['chat','reasoning','coding','vision','ocr','tts','moderation','agents'], key:'MISTRAL_API_KEY', maxModel:process.env.MISTRAL_MODEL || 'mistral-medium-3.5' },
  { id:'deepseek', name:'DeepSeek', class:'reasoning-coding', modalities:['chat','reasoning','coding','vision'], key:'DEEPSEEK_API_KEY', maxModel:process.env.DEEPSEEK_MODEL || 'deepseek-chat' },
  { id:'cohere', name:'Cohere', class:'enterprise-rag', modalities:['chat','rerank','embeddings','classification'], key:'COHERE_API_KEY', maxModel:process.env.COHERE_MODEL || 'command-a' },
  { id:'perplexity', name:'Perplexity', class:'search-research', modalities:['chat','research','web-search'], key:'PERPLEXITY_API_KEY', maxModel:process.env.PERPLEXITY_MODEL || 'sonar-pro' },
  { id:'groq', name:'Groq', class:'high-throughput', modalities:['chat','reasoning','coding','speech-to-text'], key:'GROQ_API_KEY', maxModel:process.env.GROQ_MODEL || 'configured' },
  { id:'cerebras', name:'Cerebras', class:'high-throughput', modalities:['chat','reasoning','coding'], key:'CEREBRAS_API_KEY', maxModel:process.env.CEREBRAS_MODEL || 'configured' },
  { id:'openrouter', name:'OpenRouter', class:'multi-provider', modalities:['chat','reasoning','coding','vision','image','audio','agents'], key:'OPENROUTER_API_KEY', maxModel:process.env.OPENROUTER_MODEL || 'configured' },
  { id:'amazon-bedrock', name:'Amazon Bedrock', class:'multi-provider', modalities:['chat','reasoning','coding','vision','image','video','audio','embeddings','agents'], key:'AWS_ACCESS_KEY_ID', maxModel:process.env.BEDROCK_MODEL_ID || 'dynamic-catalog' },
  { id:'qwen', name:'Alibaba Qwen', class:'open-model', modalities:['chat','reasoning','coding','vision','image','audio'], key:'QWEN_API_KEY', maxModel:process.env.QWEN_MODEL || 'configured' },
  { id:'kimi', name:'Moonshot Kimi', class:'open-model', modalities:['chat','reasoning','coding','vision'], key:'MOONSHOT_API_KEY', maxModel:process.env.KIMI_MODEL || 'configured' },
  { id:'minimax', name:'MiniMax', class:'multimodal', modalities:['chat','reasoning','coding','image','video','audio','voice'], key:'MINIMAX_API_KEY', maxModel:process.env.MINIMAX_MODEL || 'configured' },
  { id:'nvidia', name:'NVIDIA NIM', class:'inference-platform', modalities:['chat','reasoning','coding','vision','embeddings'], key:'NVIDIA_API_KEY', maxModel:process.env.NVIDIA_MODEL || 'configured' },
  { id:'together', name:'Together AI', class:'open-model', modalities:['chat','reasoning','coding','vision','image','embeddings'], key:'TOGETHER_API_KEY', maxModel:process.env.TOGETHER_MODEL || 'configured' },
  { id:'fireworks', name:'Fireworks AI', class:'open-model', modalities:['chat','reasoning','coding','vision','image','audio'], key:'FIREWORKS_API_KEY', maxModel:process.env.FIREWORKS_MODEL || 'configured' },
  { id:'huggingface', name:'Hugging Face', class:'open-model', modalities:['chat','coding','vision','image','audio','embeddings'], key:'HF_TOKEN', maxModel:process.env.HF_MODEL || 'dynamic-catalog' },
  { id:'cloudflare', name:'Cloudflare Workers AI', class:'edge-inference', modalities:['chat','embeddings','image','speech-to-text','text-to-speech'], key:'CLOUDFLARE_API_TOKEN', maxModel:process.env.CLOUDFLARE_MODEL || 'dynamic-catalog' },
  { id:'stability', name:'Stability AI', class:'creative', modalities:['image','video','3d','audio'], key:'STABILITY_API_KEY', maxModel:process.env.STABILITY_MODEL || 'dynamic-catalog' },
  { id:'runway', name:'Runway', class:'creative', modalities:['video','image'], key:'RUNWAYML_API_SECRET', maxModel:process.env.RUNWAY_MODEL || 'dynamic-catalog' }
];

export function getAiCatalog() {
  return AI_CATALOG.map(({ key, alternateKeys = [], ...entry }) => ({
    ...entry,
    configured: [key, ...alternateKeys].some(envConfigured),
    credential: key
  }));
}

export function getAiCategories() {
  const categories = new Map();
  for (const entry of AI_CATALOG) for (const modality of entry.modalities) {
    if (!categories.has(modality)) categories.set(modality, []);
    categories.get(modality).push(entry.id);
  }
  return Object.fromEntries([...categories].sort((a,b)=>a[0].localeCompare(b[0])));
}
