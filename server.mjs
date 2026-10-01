import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;
const HF_TOKEN = process.env.HF_TOKEN;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    res.sendFile(indexPath, (err) => {
        if (err) {
            res.status(200).send(`
                <!DOCTYPE html>
                <html>
                <head><title>Apex Studio</title></head>
                <body style="background:#0a0a0f; color:#c6a87c; text-align:center; padding-top:50px;">
                    <h1>Apex Studio Online</h1>
                    <p>Server is running on port ${PORT}, but public/index.html was not found.</p>
                </body>
                </html>
            `);
        }
    });
});

// UPGRADED ORACLE (Documentary Script Engine)
app.post('/api/oracle', async (req, res) => {
    try {
        const { era, theme, pacing, details } = req.body;
        
        const systemPrompt = `You are a master historical documentarian and screenwriter. You are writing a script for a massive video series covering the entire Bible. 
        Format the output strictly as a video script: 
        [VISUAL: Describe the sweeping 8k visual] 
        [NARRATOR: Write the profound, cinematic voiceover].`;
        
        const userPrompt = `Draft a script sequence for the following era: ${era}. 
        Core Theme: ${theme}. 
        Pacing: ${pacing}. 
        Specific details to include: ${details}`;

        const response = await fetch("https://router.huggingface.co/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${HF_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "moonshotai/Kimi-K2-Instruct",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                max_tokens: 1500,
                temperature: 0.8,
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

// UPGRADED FORGE (Cinematic Render Engine)
app.post('/api/forge', async (req, res) => {
    try {
        const { scene, shotType, lighting, mood } = req.body;
        const masterPrompt = `${scene}, ${shotType}, ${lighting} lighting, ${mood} atmosphere, 16:9 aspect ratio, 8k resolution, photorealistic cinematic documentary footage, Unreal Engine 5 render, highly detailed`;

        // FIXED URL HERE
        const response = await fetch("https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell", {
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

// UPGRADED BARD (Voiceover Engine)
app.post('/api/bard', async (req, res) => {
    try {
        const { text } = req.body;
        
        // FIXED URL HERE
        const response = await fetch("https://api-inference.huggingface.co/models/suno/bark", {
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
    console.log(`Apex Studio Production Deck active on network port: ${PORT}`);
});
