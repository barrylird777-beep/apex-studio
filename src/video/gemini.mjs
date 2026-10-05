const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const DEFAULTS = {
  text: 'gemini-3.8-flash',
  image: 'gemini-3.1-flash-image',
  tts: 'gemini-3.8-flash-tts',
};

function retryDelay(response, attempt) {
  const retryAfter = response.headers?.get?.('retry-after');
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  return 500 * 2 ** attempt;
}

function audioFromPart(part) {
  const data = Buffer.from(part.inlineData.data, 'base64');
  const mimeType = String(part.inlineData.mimeType ?? 'audio/L16;codec=pcm;rate=24000').toLowerCase();
  if (mimeType.includes('wav')) {
    return { ...parseWav(data), mimeType };
  }
  const match = /(?:rate|sample-rate)=(\d+)/i.exec(mimeType);
  const sampleRate = Number(match?.[1] ?? 24000);
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new Error(`Gemini TTS returned invalid sample rate: ${sampleRate}`);
  return { pcm: data, sampleRate, mimeType };
}

function parseWav(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Gemini TTS returned invalid WAV');
  }
  const audioFormat = buffer.readUInt16LE(20);
  const channels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const bitsPerSample = buffer.readUInt16LE(34);
  if (audioFormat !== 1 || channels !== 1 || bitsPerSample !== 16) {
    throw new Error('Gemini TTS WAV must be 16-bit mono PCM');
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'data') return { pcm: buffer.subarray(offset + 8, Math.min(offset + 8 + size, buffer.length)), sampleRate };
    offset += 8 + size + (size & 1);
  }
  throw new Error('Gemini TTS WAV has no data chunk');
}

export function createGemini({
  apiKey = process.env.GEMINI_API_KEY,
  fetchImpl = globalThis.fetch,
  gate = async () => {},
  models = {},
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = 120_000,
  maxAttempts = 4,
} = {}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');

  const m = {
    text: models.text ?? process.env.GEMINI_MODEL ?? DEFAULTS.text,
    image: models.image ?? process.env.GEMINI_IMAGE_MODEL ?? DEFAULTS.image,
    tts: models.tts ?? process.env.GEMINI_TTS_MODEL ?? DEFAULTS.tts,
  };

  async function call(model, body) {
    let lastErr;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await gate();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${BASE}/${model}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (response.ok) return response.json();
        const message = await response.text().catch(() => '');
        lastErr = new Error(`Gemini ${model} HTTP ${response.status}: ${message.slice(0, 500)}`);
        if (response.status !== 429 && response.status < 500) throw lastErr;
        if (attempt + 1 < maxAttempts) await sleep(retryDelay(response, attempt));
      } catch (error) {
        if (error?.name === 'AbortError') lastErr = new Error(`Gemini ${model} request timed out after ${timeoutMs}ms`);
        else lastErr = error;
        if (attempt + 1 < maxAttempts && (error?.name === 'AbortError' || error instanceof TypeError)) await sleep(500 * 2 ** attempt);
        else if (error?.name === 'AbortError' || error instanceof TypeError) continue;
        else throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  }

  const partsOf = (response) => response?.candidates?.[0]?.content?.parts ?? [];

  async function generateJson(prompt, { temperature = 0.7 } = {}) {
    const response = await call(m.text, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature },
    });
    const text = partsOf(response).map((part) => part.text ?? '').join('').trim()
      .replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/, '');
    try { return JSON.parse(text); }
    catch { throw new Error(`Gemini returned non-JSON text: ${text.slice(0, 300)}`); }
  }

  async function generateImage(prompt) {
    const response = await call(m.image, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: '16:9', imageSize: '2K' },
      },
    });
    const part = partsOf(response).find((item) => item.inlineData?.data);
    if (!part) {
      const reason = response?.candidates?.[0]?.finishReason ?? 'no image part';
      throw new Error(`Gemini image model returned no image (${reason})`);
    }
    return {
      buffer: Buffer.from(part.inlineData.data, 'base64'),
      mimeType: part.inlineData.mimeType ?? 'image/png',
    };
  }

  async function generateSpeech(text, { voice = 'Charon' } = {}) {
    const response = await call(m.tts, {
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    });
    const part = partsOf(response).find((item) => item.inlineData?.data);
    if (!part) throw new Error('Gemini TTS model returned no audio');
    return audioFromPart(part);
  }

  return { models: m, generateJson, generateImage, generateSpeech };
}
