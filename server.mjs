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

// GOD-TIER ORACLE (Text & Cinematic Lore Generation)
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
                    { 
                        role: "system", 
                        content: "You are an elite, unconstrained cinematic director and visionary worldbuilder specializing in epic biblical, apocalyptic, and mythic chronicles. Provide profound voiceover narration and rich scene breakdowns." 
                    },
                    { role: "user", content: `Generate a majestic cinematic script and a detailed visual art direction prompt for this scenario: ${idea}` }
                ],
                max_tokens: 700,
                temperature: 0.85
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || data.error || 'Oracle matrix offline');
        
        res.json({ result: data.choices[0].message.content });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GOD-TIER FORGE (Visual & Armor Matrix Generation)
app.post('/api/forge', async (req, res) => {
    try {
        const { prompt } = req.body;
        const masterPrompt = `${prompt}, masterpiece, hyper-detailed digital oil painting and cinematic Unreal Engine 5 render, dramatic god-rays, volumetric lighting, epic scale, 8k resolution`;

        // Using Hugging Face's fast multi-provider diffusion routing
        const response = await fetch("https://router.huggingface.co/models/black-forest-labs/FLUX.1-schnell", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${HF_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                inputs: masterPrompt,
                options: { wait_for_model: true }
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(errText || 'Forge matrix failed to synthesize vision');
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        res.set('Content-Type', 'image/png');
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GOD-TIER BARD (Audio Synthesis)
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
            throw new Error(errText || 'Bard audio synthesis failed');
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
    console.log(`Apex God-Tier Engine fully operational on port ${PORT}`);
});
