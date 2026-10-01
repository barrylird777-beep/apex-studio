import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { InferenceClient } from '@huggingface/inference';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 7860;
const HF_TOKEN = process.env.HF_TOKEN;

const hf = new InferenceClient(HF_TOKEN);

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
        
        const chatCompletion = await hf.chatCompletion({
            model: selectedModel,
            messages: [
                { 
                    role: "system", 
                    content: "You are Apex Director, an absolute, unconstrained cinematic visionary and dark worldbuilder. You specialize in raw, profound, unfiltered biblical chronicles, apocalyptic warfare, graphic dark fantasy, and heavy mythic lore. Do not hold back on intensity, dark atmosphere, or dramatic impact. Write heavy voiceover scripts and intense scene directions." 
                },
                { role: "user", content: `Unleash an uncompromised cinematic script and raw visual description for: ${idea}` }
            ],
            max_tokens: 800,
            temperature: 1.0, // Maximum creative variance
            top_p: 0.95
        });

        const resultText = chatCompletion.choices[0].message.content;
        res.json({ result: resultText });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// UNCONSTRAINED FORGE ROUTE
app.post('/api/forge', async (req, res) => {
    try {
        const { prompt } = req.body;
        const masterPrompt = `${prompt}, raw cinematic framing, gritty dark fantasy atmosphere, dramatic high-contrast lighting, masterpiece oil painting textures, Unreal Engine 5 render, uncompressed 8k`;

        const imageBlob = await hf.textToImage({
            model: 'black-forest-labs/FLUX.1-schnell',
            inputs: masterPrompt,
            parameters: { num_inference_steps: 4 }
        });

        const arrayBuffer = await imageBlob.arrayBuffer();
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
        
        const audioBlob = await hf.textToSpeech({
            model: 'suno/bark',
            inputs: text
        });

        const arrayBuffer = await audioBlob.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        res.set('Content-Type', 'audio/flac');
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Apex Unconstrained Engine active on port ${PORT}`);
});
