(() => {
  if (document.getElementById('apex-assistant-launch')) return;
  const style = document.createElement('style');
  style.textContent = `
    #apex-assistant-launch{position:fixed;right:18px;bottom:18px;z-index:2147483000;border:1px solid #6b8ed6;border-radius:999px;padding:12px 16px;background:#17243c;color:#fff;font:600 14px system-ui;box-shadow:0 8px 28px #0007;cursor:pointer}
    #apex-assistant-panel{position:fixed;right:18px;bottom:76px;z-index:2147483000;width:min(420px,calc(100vw - 24px));max-height:min(78vh,700px);overflow:auto;background:#101722;color:#eef3ff;border:1px solid #46536a;border-radius:16px;padding:16px;box-shadow:0 16px 56px #000a;font:14px/1.5 system-ui}
    #apex-assistant-panel[hidden]{display:none}
    #apex-assistant-panel header{display:flex;align-items:center;justify-content:space-between;gap:12px}
    #apex-assistant-panel h2{font-size:18px;margin:0}
    #apex-assistant-panel label{display:block;margin-top:12px}
    #apex-assistant-panel textarea{width:100%;box-sizing:border-box;min-height:92px;margin-top:5px;padding:10px;background:#080d14;color:#fff;border:1px solid #46536a;border-radius:8px;font:14px/1.5 system-ui}
    #apex-assistant-panel button{border:1px solid #46536a;border-radius:8px;padding:8px 10px;background:#202d41;color:#fff;cursor:pointer}
    #apex-assistant-panel button:disabled{opacity:.5;cursor:not-allowed}
    #apex-assistant-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
    #apex-assistant-status{color:#b9c8e2;font-size:12px;margin:10px 0}
    #apex-assistant-output{white-space:pre-wrap;overflow-wrap:anywhere;background:#080d14;border:1px solid #303c50;border-radius:8px;padding:10px;min-height:50px}
    @media(prefers-reduced-motion:reduce){#apex-assistant-panel *{scroll-behavior:auto!important}}
  `;
  document.head.append(style);
  const launch = document.createElement('button');
  launch.id = 'apex-assistant-launch';
  launch.type = 'button';
  launch.textContent = 'Apex Assistant';
  launch.setAttribute('aria-controls', 'apex-assistant-panel');
  launch.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('section');
  panel.id = 'apex-assistant-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', 'apex-assistant-title');
  panel.innerHTML = '<header><h2 id="apex-assistant-title">Apex Assistant</h2><button type="button" id="apex-assistant-close" aria-label="Close assistant">Close</button></header><p>Use text or push-to-talk voice input. Responses use the configured AI route; browser speech playback can be interrupted. Conversation history is not saved by this overlay.</p><label for="apex-assistant-input">Prompt</label><textarea id="apex-assistant-input" maxlength="6000" placeholder="Ask Apex…"></textarea><div id="apex-assistant-actions"><button type="button" id="apex-assistant-send">Send</button><button type="button" id="apex-assistant-listen">Listen</button><button type="button" id="apex-assistant-speak" disabled>Speak response</button><button type="button" id="apex-assistant-stop">Stop audio</button></div><p id="apex-assistant-status" role="status" aria-live="polite">Ready. A control token is required to send prompts.</p><div id="apex-assistant-output" aria-live="polite">No response yet.</div>';
  document.body.append(launch, panel);
  const $ = id => document.getElementById(id);
  let latestResponse = '';
  let recognition = null;
  let listening = false;
  const setStatus = value => { $('apex-assistant-status').textContent = value; };
  function stopAudio() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }
  function closePanel() {
    panel.hidden = true;
    launch.setAttribute('aria-expanded', 'false');
    stopAudio();
    if (recognition && listening) recognition.stop();
    launch.focus();
  }
  launch.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    launch.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) $('apex-assistant-input').focus();
    else stopAudio();
  });
  $('apex-assistant-close').addEventListener('click', closePanel);
  $('apex-assistant-stop').addEventListener('click', () => { stopAudio(); setStatus('Audio stopped.'); });
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') closePanel(); });
  async function sendPrompt() {
    const prompt = $('apex-assistant-input').value.trim();
    if (!prompt) { setStatus('Enter a prompt first.'); return; }
    const token = sessionStorage.getItem('apex.phone.sessionToken') || '';
    if (!token) { setStatus('Open Phone Control in this tab and enter your control token first.'); return; }
    $('apex-assistant-send').disabled = true;
    setStatus('Generating response…');
    stopAudio();
    try {
      const response = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-apex-shortcut-token': token },
        body: JSON.stringify({ prompt, system: 'Answer accurately, identify uncertainty, and do not claim verification without evidence.' })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'AI request failed');
      latestResponse = String(data.text || data.output || '');
      if (!latestResponse) throw new Error('AI provider returned no text');
      $('apex-assistant-output').textContent = latestResponse;
      $('apex-assistant-speak').disabled = !('speechSynthesis' in window && 'SpeechSynthesisUtterance' in window);
      setStatus('Response ready · ' + String(data.provider || 'AI mesh') + '. Nothing was saved by this overlay.');
    } catch (error) {
      setStatus('Request failed: ' + String(error?.message || error));
    } finally {
      $('apex-assistant-send').disabled = false;
    }
  }
  $('apex-assistant-send').addEventListener('click', sendPrompt);
  $('apex-assistant-input').addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void sendPrompt(); }
  });
  $('apex-assistant-speak').addEventListener('click', () => {
    if (!latestResponse || !('speechSynthesis' in window)) return;
    stopAudio();
    const utterance = new SpeechSynthesisUtterance(latestResponse);
    utterance.onstart = () => setStatus('Speaking. Press Listen or Stop audio to interrupt.');
    utterance.onend = () => setStatus('Speech finished.');
    utterance.onerror = () => setStatus('Speech playback stopped by the browser.');
    window.speechSynthesis.speak(utterance);
  });
  $('apex-assistant-listen').addEventListener('click', () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { setStatus('Speech recognition is unavailable in this browser. Use the text prompt.'); return; }
    stopAudio();
    if (recognition && listening) { recognition.stop(); return; }
    recognition = new Recognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = event => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      $('apex-assistant-input').value = transcript.trim();
      if (event.results[event.results.length - 1].isFinal) setStatus('Voice captured. Press Send to submit it.');
    };
    recognition.onerror = event => setStatus('Speech input unavailable: ' + String(event.error || 'recognition error'));
    recognition.onend = () => { listening = false; $('apex-assistant-listen').textContent = 'Listen'; };
    try {
      recognition.start();
      listening = true;
      $('apex-assistant-listen').textContent = 'Stop listening';
      setStatus('Listening. Speech input is processed by the browser speech-recognition service.');
    } catch (error) {
      setStatus('Could not start speech input: ' + String(error?.message || error));
    }
  });
})();
