import express from 'express';
const router = express.Router();

// The Visual Forge Space (Local DoP Pipeline -> FLUX Engine)
router.post('/', async (req, res) => {
    try {
        const { scene, shotType, lighting, mood } = req.body;
        console.log("1. Local DoP Intercepting script...");

        // 1. Local DoP: Pure JavaScript Prompt Engineering (No fragile external text APIs)
        // Strip out screenplay jargon, bold asterisks, and bracketed text
        let cleanScene = scene.replace(/\b(EXT\.|INT\.|NIGHT|DAY|MORNING|EVENING|CAMERA|SLAMS|FADES)\b/g, '');
        cleanScene = cleanScene.replace(/\[.*?\]/g, ''); 
        cleanScene = cleanScene.replace(/\*+/g, ''); 
        
        // Remove extra spacing
        cleanScene = cleanScene.replace(/\s+/g, ' ').trim();

        // 2. Build the mathematically perfect FLUX prompt
        const optimizedPrompt = `${shotType}, ${cleanScene}, environment lighting: ${lighting}, cinematic mood: ${mood}, highly detailed, 8k resolution, cinematic masterpiece, photorealistic`;
        
        console.log("2. DoP Optimized Prompt:", optimizedPrompt);

        // 3. Send the sanitized prompt directly to the FLUX visual engine
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
