import express from 'express';
const router = express.Router();

// The Visual Forge Space
router.post('/', async (req, res) => {
    try {
        const { scene, shotType, lighting, mood } = req.body;
        console.log("1. Intercepting script in Forge Space...");

        const dopInstruction = `Rewrite this screenplay scene into a literal, comma-separated visual prompt for an AI image generator. Focus ONLY on physical geometry, scale, subjects, and environment. Merge it with: Lens: ${shotType}. Lighting: ${lighting}. Mood: ${mood}. Do not include narrative text, actions, or camera jargon. Scene to translate: ${scene}`;
        
        const textResponse = await fetch('https://text.pollinations.ai/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: [
                    { role: 'system', content: 'You are an expert AI image prompt engineer.' },
                    { role: 'user', content: dopInstruction }
                ],
                model: 'openai'
            })
        });
        
        if (!textResponse.ok) throw new Error(`DoP AI failed with status: ${textResponse.status}`);
        const optimizedPrompt = await textResponse.text();
        console.log("2. DoP Optimized Prompt:", optimizedPrompt);

        const ghostUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(optimizedPrompt)}?width=1920&height=1080&model=flux&nologo=true`;
        console.log("3. Igniting FLUX Forge...");

        const response = await fetch(ghostUrl);
        if (!response.ok) throw new Error(`Visual API failed with status: ${response.status}`);

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        res.set('Content-Type', 'image/jpeg');
        res.send(buffer);
    } catch (error) {
        console.error("Forge Error:", error.message);
        res.status(500).json({ error: error.message });
    }
});

export default router;
