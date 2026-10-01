const express = require('express');
const { InferenceClient } = require('@huggingface/inference');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 7860;
const HF_TOKEN = process.env.HF_TOKEN; // Your Hugging Face API key

const hf = new InferenceClient(HF_TOKEN);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 1. Oracle Text Endpoint (Using Top-Tier Reasoning Model)
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

// 2. Forge Image Endpoint (Using FLUX.1-dev)
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

app.listen(PORT, () => {
    console.log(`Apex God-Tier Engine active on port ${PORT}`);
});
