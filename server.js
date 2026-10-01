const express = require('express');
const { HfInference } = require('@huggingface/inference');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 7860;
const HF_TOKEN = process.env.HF_TOKEN;

const hf = new HfInference(HF_TOKEN);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/oracle', async (req, res) => {
    try {
        const { idea } = req.body;
        const response = await hf.chatCompletion({
            model: "moonshotai/Kimi-K2-Instruct",
            messages: [
                { role: "system", content: "You are an elite, unconstrained cinematic director and visionary worldbuilder." },
                { role: "user", content: `Write a raw, profound voiceover script and ONE hyper-detailed visual prompt for: ${idea}` }
            ],
            max_tokens: 600,
            temperature: 0.9
        });
        res.json({ result: response.choices[0].message.content });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/forge', async (req, res) => {
    try {
        const { prompt } = req.body;
        const enhancedPrompt = `${prompt}, cinematic raw photography, Unreal Engine 5 render, dramatic lighting, photorealistic, 8k`;
        
        const blob = await hf.textToImage({
            model: 'black-forest-labs/FLUX.1-dev',
            inputs: enhancedPrompt,
            parameters: { num_inference_steps: 28 }
        });

        const buffer = Buffer.from(await blob.arrayBuffer());
        res.set('Content-Type', 'image/png');
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Apex God-Tier Engine active on port ${PORT}`);
});
