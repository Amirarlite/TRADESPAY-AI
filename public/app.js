const micBtn = document.getElementById('start-voice-btn');
const statusLog = document.getElementById('status-log');
const resultContainer = document.getElementById('result-container');
const jsonOutput = document.getElementById('json-output');

// Initialize Native Browser Speech Recognition
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (!SpeechRecognition) {
    statusLog.innerHTML = "🎙️ <strong>Firefox/Safari Mode Active:</strong> Tap below to record. Speak naturally, then tap again to generate your invoice.";
    
    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;
    
    micBtn.addEventListener('click', async () => {
        if (!isRecording) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream);
                audioChunks = [];
                
                mediaRecorder.ondataavailable = (event) => {
                    audioChunks.push(event.data);
                };
                
                mediaRecorder.onstop = async () => {
                    statusLog.innerHTML = "<span style='color: #60a5fa;'>🧠 Transcribing audio and building invoice via Groq Whisper...</span>";
                    
                    try {
                        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                        const formData = new FormData();
                        formData.append('audio', audioBlob, 'voice-recording.webm');
                        
                        const response = await fetch('/api/ai/voice-to-invoice-file', {
                            method: 'POST',
                            body: formData
                        });
                        
                        const data = await response.json();
                        if (data.error) throw new Error(data.error);
                        
                        statusLog.innerHTML = `<strong>Heard:</strong> "${data.transcript}"<br><br><span style='color: #4ade80;'>✅ Invoice successfully generated via Groq/LLM!</span>`;
                        resultContainer.style.display = 'block';
                        jsonOutput.innerText = JSON.stringify(data.invoice, null, 2);
                    } catch (error) {
                        console.error(error);
                        statusLog.innerHTML = `<span style='color: #f87171;'>❌ AI Error: ${error.message}</span>`;
                    }
                };
                
                mediaRecorder.start();
                isRecording = true;
                micBtn.innerText = "🛑 Stop Recording";
                micBtn.classList.add('listening');
                statusLog.innerHTML = "<span style='color: #fbbf24;'>🎙️ Recording active... Speak your job description naturally.</span>";
                resultContainer.style.display = "none";
            } catch (err) {
                console.error(err);
                statusLog.innerHTML = `<span style='color: #f87171;'>❌ Microphone Access Error: ${err.message}</span>`;
            }
        } else {
            mediaRecorder.stop();
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
            isRecording = false;
            micBtn.innerText = "🎙️ Tap to Speak";
            micBtn.classList.remove('listening');
        }
    });
} else {
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = 'en-US';

    micBtn.addEventListener('click', () => {
        recognition.start();
        micBtn.innerText = "🛑 Listening...";
        micBtn.classList.add('listening');
        statusLog.innerHTML = "<span style='color: #fbbf24;'>🎙️ Microphone active. Speak naturally...</span>";
        resultContainer.style.display = "none";
    });

    recognition.onresult = async (event) => {
        micBtn.innerText = "🎙️ Tap to Speak";
        micBtn.classList.remove('listening');
        
        const transcript = event.results[0][0].transcript;
        statusLog.innerHTML = `<strong>Heard:</strong> "${transcript}"<br><br><span style='color: #60a5fa;'>🧠 Routing to TradesPay AI Engine...</span>`;

        try {
            const response = await fetch('/api/ai/voice-to-invoice', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transcript })
            });
            
            const data = await response.json();
            if (data.error) throw new Error(data.error);

            statusLog.innerHTML = "<span style='color: #4ade80;'>✅ Invoice successfully generated via Groq/LLM!</span>";
            resultContainer.style.display = 'block';
            jsonOutput.innerText = JSON.stringify(data.invoice, null, 2);
            
        } catch (error) {
            console.error(error);
            statusLog.innerHTML = `<span style='color: #f87171;'>❌ AI Error: ${error.message}</span>`;
        }
    };

    recognition.onerror = (event) => {
        micBtn.innerText = "🎙️ Tap to Speak";
        micBtn.classList.remove('listening');
        statusLog.innerHTML = `<span style='color: #f87171;'>❌ Microphone Error: ${event.error}</span>`;
    };
}