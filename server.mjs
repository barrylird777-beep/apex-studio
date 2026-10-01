import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 7860;
const HF_TOKEN = process.env.HF_TOKEN;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/oracle', async (req, res) => {
    try {
        const { idea, model } = req.body;
        const selectedModel = model || "moonshotai/Kimi-K2-Instruct";
        
        const response = await fetch("https://router.huggingface.co/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${HF_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: selectedModel,
                messages: [
                    { role: "system", content: "You are an elite, unconstrained cinematic director and visionary worldbuilder." },
                    { role: "user", content: `Write a raw, profound voiceover script and ONE hyper-detailed visual prompt for: ${idea}` }
                ],
                max_tokens: 600,
                temperature: 0.9
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to reach Hugging Face router');
        
        res.json({ result: data.choices[0].message.content });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/forge', async (req, res) => {
    try {
        const { prompt } = req.body;
        const enhancedPrompt = `${prompt}, cinematic raw photography, Unreal Engine 5 render, dramatic lighting, photorealistic, 8k`;
        
        const response = await fetch("https://router.huggingface.co/models/black-forest-labs/FLUX.1-dev", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${HF_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                inputs: enhancedPrompt,
                parameters: { num_inference_steps: 28 }
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(errText || 'Failed to generate image');
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        res.set('Content-Type', 'image/png');
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/bard', async (req, res) => {
    try {
        const { text } = req.body;
        const response = await fetch("https://router.huggingface.co/models/suno/bark", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${HF_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ inputs: text })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(errText || 'Failed to generate audio');
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        res.set('Content-Type', 'audio/flac');
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Apex God-Tier Engine active on port ${PORT}`);
});
