import express from 'express';
const router = express.Router();

// The Master Oracle Space (Script Engine)
router.post('/', async (req, res) => {
    try {
        const { era, duration, pacing, score, details } = req.body;
        
        console.log("Consulting Oracle...");

        const prompt = `Write a cinematic production script for a biblical scene. 
        Epoch: ${era}. Duration: ${duration}. Pacing/Tone: ${pacing}. Score: ${score}. 
        Details: ${details}. 
        Format it professionally. Include [VISUAL] blocks for scene descriptions and [NARRATOR / AUDIO] blocks for voiceover.`;

        // Using the secure POST method for the Oracle text generation
        const textResponse = await fetch('https://text.pollinations.ai/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: [
                    { role: 'system', content: 'You are an expert cinematic screenwriter.' },
                    { role: 'user', content: prompt }
                ],
                model: 'openai'
            })
        });

        if (!textResponse.ok) throw new Error(`Oracle AI failed with status: ${textResponse.status}`);
        
        const scriptText = await textResponse.text();
        res.json({ result: scriptText });

    } catch (error) {
        console.error("Oracle Error:", error.message);
        res.status(500).json({ error: error.message });
    }
});

export default router;
