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
        res.
