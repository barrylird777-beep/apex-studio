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

// Health check endpoint to stabilize Railway proxy
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Main Route with Fallback
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    res.sendFile(indexPath, (err) => {
        if (err) {
            res.status(200).send(`
                <!DOCTYPE html>
                <html>
                <head><title>Apex Studio - Emergency Mode</title></head>
                <body style="background:#050508; color:#d4af37; font-family:sans-serif; text-align:center; padding-top:50px;">
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
        const { era, pacing, duration, score, details } = req.body;
        
        const systemPrompt = `You are a master historical documentarian and screenwriter for a massive cinematic series covering the biblical timeline. 
        You must format the output strictly as a professional Production Deck timeline. 
        
        For every scene, output a combined block with separate, detailed components like this:
        
        [TIMESTAMP: 00:00 - 00:15]
        [VISUAL]: (Highly detailed visual description, camera movement, and lighting)
        [NARRATOR / AUDIO]: (The exact profound, cinematic voiceover text)
        [SOUND DESIGN]: (SFX and musical score details)
        
        Repeat this structure sequentially for the entire requested duration.`;
        
        const userPrompt = `Draft a highly detailed production script for the following epoch: ${era}. 
        Target Segment Duration: ${duration}.
        Pacing & Tone: ${pacing}. 
        Musical Score Directive: ${score}.
        Specific Narrative Details: ${details}`;

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
                max_tokens: 2500,
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

// UPGRADED FORGE (Ghost API / No-Auth Render)
app.post('/api/forge', async (req, res) => {
    try {
        const { scene, shotType, lighting, mood } = req.body;
        
        // Build the prompt
        const masterPrompt = `${scene}, ${shotType}, ${lighting}, ${mood}, cinematic documentary footage, highly detailed, 8k resolution`;
        
        // URL-encode the prompt so it can be safely passed in a web link
        const encodedPrompt = encodeURIComponent(masterPrompt);
        
        // Hit the Pollinations endpoint directly (1920x1080 resolution, no logo)
        const ghostUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1920&height=1080&nologo=true`;
        
        console.log("Igniting Forge via Ghost API...");

        const response = await fetch(ghostUrl);

        if (!response.ok) {
            throw new Error(`Ghost API failed with status: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        res.set('Content-Type', 'image/jpeg');
        res.send(buffer);
    } catch (error) {
        console.error("Forge Error:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// UPGRADED BARD (Voiceover Engine)
app.post('/api/bard', async (req, res) => {
    try {
        const { text } = req.body;
        
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
