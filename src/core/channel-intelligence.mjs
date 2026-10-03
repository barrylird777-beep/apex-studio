export function analyzeChannelLifetime(input={}){const videos=Array.isArray(input.videos)?input.videos:[];return {videoCount:videos.length,videos};}
export function createScriptPrompt(input={}){return {topic:String(input.topic||''),prompt:'Create a production-ready YouTube script about '+String(input.topic||'')};}
