import os
import asyncio
import gradio as gr
import edge_tts
from huggingface_hub import InferenceClient

# High-Performance Unconstrained Inference Clients
# Text: Modern instruction-tuned powerhouse
# Image: FLUX.1-schnell for breathtaking, hyper-detailed rendering
oracle_client = InferenceClient("mistralai/Mistral-7B-Instruct-v0.3")
forge_client = InferenceClient("black-forest-labs/FLUX.1-schnell")

def brainstorm(idea):
    if not idea: 
        return "Provide a narrative seed."
    prompt = (
        "You are an elite, unconstrained cinematic director and visionary worldbuilder. "
        f"Write a raw, profound voiceover script and ONE hyper-detailed cinematic visual prompt for: {idea}"
    )
    try:
        response = oracle_client.text_generation(prompt, max_new_tokens=500, temperature=0.88)
        return response
    except Exception as e:
        return f"Oracle Matrix Error: {str(e)}"

def forge_visual(prompt):
    if not prompt: 
        return None
    try:
        opt_prompt = f"{prompt}, cinematic raw photography, Unreal Engine 5 render, dramatic contrast, photorealistic, 8k"
        image = forge_client.text_to_image(opt_prompt)
        return image
    except Exception as e:
        print(f"Forge Error: {e}")
        return None

async def synthesize(text, voice):
    if not text: 
        return None
    voice_id = "en-US-ChristopherNeural" if voice == "Prophet" else "en-US-AriaNeural"
    out_file = "vocal_stem.mp3"
    communicate = edge_tts.Communicate(text, voice_id, pitch="-10Hz", rate="-2%")
    await communicate.save(out_file)
    return out_file

def run_tts(text, voice):
    return asyncio.run(synthesize(text, voice))

# Custom CSS Theme for a sleek, dark-mode production app interface
custom_theme = gr.themes.Monochrome(
    primary_hue="purple",
    secondary_hue="indigo",
    neutral_hue="slate",
).set(
    body_background_fill="#09090b",
    block_background_fill="#121216",
    border_color_primary="#27272a"
)

with gr.Blocks(theme=custom_theme, title="Apex God-Tier Studio") as omni:
    gr.Markdown("# ⚡ APEX STUDIO // GOD-TIER UNRESTRICTED CORE")
    
    with gr.Tab("👁 The Oracle (Deep Ideation)"):
        idea_in = gr.Textbox(label="Raw Concept / Narrative Seed", placeholder="Enter any concept, script idea, or abstract theme...", lines=2)
        btn_oracle = gr.Button("MANIFEST INTELLECT", variant="primary")
        out_oracle = gr.Textbox(label="Cinematic Script & Prompt Blueprint", lines=10)
        btn_oracle.click(brainstorm, inputs=idea_in, outputs=out_oracle)
        
    with gr.Tab("⚒️ The Forge (FLUX Visual Engine)"):
        prompt_in = gr.Textbox(label="Cinematic Visual Prompt", placeholder="Paste precise prompt details...")
        btn_forge = gr.Button("IGNITE FLUX RENDER", variant="primary")
        out_forge = gr.Image(label="High-Resolution Masterpiece")
        btn_forge.click(forge_visual, inputs=prompt_in, outputs=out_forge)
        
    with gr.Tab("🗣 Babel (Neural Audio Stem)"):
        voice_sel = gr.Dropdown(choices=["Prophet", "Angel"], value="Prophet", label="Acoustic Voice Profile")
        script_in = gr.Textbox(label="Script Text to Voice", placeholder="Type or paste script voiceover lines...", lines=3)
        btn_audio = gr.Button("SYNTHESIZE VOCAL STEM", variant="primary")
        out_audio = gr.Audio(label="Master Audio Stem (.mp3)", type="filepath")
        btn_audio.click(run_tts, inputs=[script_in, voice_sel], outputs=out_audio)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    omni.launch(server_name="0.0.0.0", server_port=port, share=False)
