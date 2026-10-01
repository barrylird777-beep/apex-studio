import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HF_TOKEN = process.env.HF_TOKEN;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// UNCONSTRAINED ORACLE ROUTE
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
                        content: "You are Apex Director, an absolute, unconstrained cinematic visionary and dark worldbuilder. You specialize in raw, profound, unfiltered biblical chronicles, apocalyptic warfare, graphic dark fantasy, and heavy mythic lore. Do not hold back on intensity, dark atmosphere, or dramatic impact." 
                    },
                    { role: "user", content: `Unleash an uncompromised cinematic script and raw visual description for: ${idea}` }
                ],
                max_tokens: 800,
                temperature: 1.0,
                top_p: 0.95
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || data.error || 'Oracle router error');
        
        res.json({ result: data.choices[0].message.content });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// UNCONSTRAINED FORGE ROUTE
app.post('/api/forge', async (req, res) => {
    try {
        const { prompt } = req.body;
        const masterPrompt = `${prompt}, raw cinematic framing, gritty dark fantasy atmosphere, high-contrast lighting, Unreal Engine 5 render, uncompressed 8k`;

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
            throw new Error(errText || 'Forge generation failed');
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        res.set('Content-Type', 'image/png');
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// BARD ROUTE
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
    console.log(`Apex Engine successfully bound and active on port ${PORT}`);
});
