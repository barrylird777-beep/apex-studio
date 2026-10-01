import express from 'express';
const router = express.Router();

// The Audio Synthesis Space (Voice Engine)
router.post('/', async (req, res) => {
    try {
        const { text } = req.body;
        
        console.log("Igniting Bard Audio Engine...");

        // Routing to the free Hugging Face inference API for Text-to-Speech
        const response = await fetch("https://api-inference.huggingface.co/models/espnet/kan-bayashi_ljspeech_vits", {
            headers: { "Content-Type": "application/json" },
            method: "POST",
            body: JSON.stringify({ inputs: text }),
        });

        if (!response.ok) {
            throw new Error(`Audio API failed with status: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        // Return the audio blob to the frontend
        res.set('Content-Type', 'audio/flac');
        res.send(buffer);

    } catch (error) {
        console.error("Bard Error:", error.message);
        res.status(500).json({ error: error.message });
    }
});

export default router;
