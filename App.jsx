import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, serverTimestamp } from 'firebase/firestore';
import { Lock, Send, ShieldCheck, User, Settings, Sparkles, FileText, Image as ImageIcon, Loader2, LogOut, Languages, Wand2, Smile, Camera, Mic, Square, Play, Pause, BrainCircuit } from 'lucide-react';

/**
 * CONFIGURACIÓN DE FIREBASE
 * Estos datos permiten que la app se conecte a la base de datos en tiempo real.
 */
const firebaseConfig = {
  apiKey: "AIzaSyDnGMGMVzKJu5xFRqujW9m-8TaTs8R-TuM",
  authDomain: "ia22-f7fd9.firebaseapp.com",
  projectId: "ia22-f7fd9",
  storageBucket: "ia22-f7fd9.firebasestorage.app",
  messagingSenderId: "1004279947646",
  appId: "1:1004279947646:web:3fe51ca7123a1162c1532f",
  measurementId: "G-LQFV4LR9DY"
};

// Clave de API de Gemini (Se recomienda mover a variables de entorno en producción)
const apiKey = ""; 

// Inicialización de servicios
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'mi-chat-privado-v2';

/**
 * UTILIDADES CRIPTOGRÁFICAS
 * Usamos la Web Crypto API nativa para asegurar que los mensajes nunca viajen en texto plano.
 */

// Genera una clave de cifrado basada en la "Frase Maestra"
const deriveKey = async (password, salt) => {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]
  );
  return window.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" },
    keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
};

// Cifra el texto antes de enviarlo a Firebase
const encryptMessage = async (text, key) => {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv }, key, new TextEncoder().encode(text)
  );
  return {
    iv: Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join(''),
    data: btoa(String.fromCharCode(...new Uint8Array(encrypted)))
  };
};

// Descifra el contenido recibido de la base de datos
const decryptMessage = async (encObj, key) => {
  try {
    const iv = new Uint8Array(encObj.iv.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const encryptedData = new Uint8Array(atob(encObj.data).split("").map(c => c.charCodeAt(0)));
    const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, encryptedData);
    return new TextDecoder().decode(decrypted);
  } catch (e) { return "🔒 [Error de descifrado: Frase Maestra incorrecta]"; }
};

/**
 * INTEGRACIONES CON LA API DE GEMINI
 */

// Llamada general para generación de texto (traducción, pulido, sugerencias)
const callGemini = async (prompt, systemPrompt = "") => {
  let retries = 0;
  const maxRetries = 5;
  const delays = [1000, 2000, 4000, 8000, 16000];
  while (retries < maxRetries) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] }
        })
      });
      const result = await response.json();
      return result.candidates?.[0]?.content?.parts?.[0]?.text;
    } catch (error) {
      retries++;
      if (retries === maxRetries) throw error;
      await new Promise(res => setTimeout(res, delays[retries - 1]));
    }
  }
};

// Generación de imágenes mediante IA (Imagen 4.0)
const generateAIImage = async (prompt) => {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: { prompt: prompt },
        parameters: { sampleCount: 1 }
      })
    });
    const result = await response.json();
    return `data:image/png;base64,${result.predictions[0].bytesBase64Encoded}`;
  } catch (error) {
    console.error("Fallo al generar imagen:", error);
    return null;
  }
};

/**
 * COMPONENTE PRINCIPAL DE LA APLICACIÓN
 */
export default function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('login'); 
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [config, setConfig] = useState({ myId: '', partnerId: '', secret: '' });
  const [cryptoKey, setCryptoKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [remembered, setRemembered] = useState(false);
  const [sentiment, setSentiment] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  // Efecto inicial: Autenticación anónima y recuperación de IDs guardados
  useEffect(() => {
    const init = async () => {
      try {
        await signInAnonymously(auth);
        const savedIds = localStorage.getItem('chat_ids');
        if (savedIds) {
          const { myId, partnerId } = JSON.parse(savedIds);
          setConfig(prev => ({ ...prev, myId, partnerId }));
          setRemembered(true);
        }
      } catch (error) {
        console.error("Error de Auth:", error);
      } finally {
        setLoading(false);
      }
    };
    init();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // Escucha de mensajes en tiempo real desde Firestore
  useEffect(() => {
    if (!user || !cryptoKey || view !== 'chat') return;

    // Crear un canal único basado en ambos IDs (alfabéticamente para que coincidan)
    const channelId = [config.myId.trim().toLowerCase(), config.partnerId.trim().toLowerCase()].sort().join('_');
    const collectionPath = `msg_v2_${channelId}`;
    
    // Ruta estricta de Firestore según las reglas de seguridad
    const q = query(collection(db, 'artifacts', appId, 'public', 'data', collectionPath));
    
    const unsubscribe = onSnapshot(q, async (snap) => {
      const newMsgs = [];
      for (const d of snap.docs) {
        const data = d.data();
        const text = await decryptMessage(data.payload, cryptoKey);
        newMsgs.push({ id: d.id, text, sender: data.sender, time: data.timestamp, type: data.type || 'text' });
      }
      // Ordenar por tiempo en memoria (evita necesidad de índices complejos)
      const sorted = newMsgs.sort((a, b) => (a.time?.toMillis() || 0) - (b.time?.toMillis() || 0));
      setMessages(sorted);
      
      // Analizar sentimiento cada 5 mensajes
      if (sorted.length > 0 && sorted.length % 5 === 0) analyzeVibe(sorted.slice(-5));
      
      // Auto-scroll al final
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }, (err) => console.error("Error de Firestore:", err));

    return () => unsubscribe();
  }, [user, cryptoKey, view, config.myId, config.partnerId]);

  // Manejo del Login y generación de llave criptográfica
  const handleSaveConfig = async (e) => {
    e.preventDefault();
    if (!config.myId || !config.partnerId || !config.secret) return;
    localStorage.setItem('chat_ids', JSON.stringify({ myId: config.myId, partnerId: config.partnerId }));
    const key = await deriveKey(config.secret, "shared_salt_v3");
    setCryptoKey(key);
    setView('chat');
  };

  const handleLogout = () => {
    setCryptoKey(null);
    setConfig(prev => ({ ...prev, secret: '' }));
    setView('login');
  };

  const handleResetUser = () => {
    localStorage.removeItem('chat_ids');
    setConfig({ myId: '', partnerId: '', secret: '' });
    setRemembered(false);
    setView('login');
  };

  // Función universal para enviar mensajes (texto, imágenes, audio)
  const sendMessage = async (content, type = 'text') => {
    if (!content || !cryptoKey) return;
    try {
      const encrypted = await encryptMessage(content, cryptoKey);
      const channelId = [config.myId.trim().toLowerCase(), config.partnerId.trim().toLowerCase()].sort().join('_');
      const collectionPath = `msg_v2_${channelId}`;
      
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', collectionPath), {
        sender: config.myId,
        payload: encrypted,
        timestamp: serverTimestamp(),
        type: type
      });
    } catch (error) { console.error("Error al enviar:", error); }
  };

  // Manejo de archivos (imágenes)
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      await sendMessage(event.target.result, 'image');
    };
    reader.readAsDataURL(file);
  };

  // Grabación de audio
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = async () => {
          await sendMessage(reader.result, 'audio');
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach(t => t.stop());
      };
      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
    } catch (err) { console.error("Error de Micrófono:", err); }
  };

  const stopRecording = () => {
    if (mediaRecorder) {
      mediaRecorder.stop();
      setIsRecording(false);
    }
  };

  /**
   * ACCIONES DE IA (GEMINI)
   */

  const analyzeVibe = async (recentMsgs) => {
    try {
      const text = recentMsgs.map(m => m.text).join(' ');
      const result = await callGemini(
        `Analiza el sentimiento de esta conversación y responde con UN SOLO EMOJI que lo represente. Texto: ${text}`,
        "Eres un experto en inteligencia emocional."
      );
      setSentiment(result?.trim());
    } catch (e) { console.error(e); }
  };

  const handleAITranslate = async () => {
    const lastOtherMsg = [...messages].reverse().find(m => m.sender !== config.myId);
    if (!lastOtherMsg) return;
    setAiLoading(true);
    try {
      const translation = await callGemini(`Traduce este mensaje al español: "${lastOtherMsg.text}"`, "Eres un traductor experto.");
      if (translation) alert(`✨ Traducción IA: ${translation}`);
    } catch (e) { console.error(e); }
    setAiLoading(false);
  };

  const handleAIPolish = async (tone) => {
    if (!inputText.trim()) return;
    setAiLoading(true);
    try {
      const polished = await callGemini(`Reescribe este mensaje en tono ${tone}: "${inputText}"`, "Eres un asistente de redacción.");
      if (polished) setInputText(polished.replace(/"/g, ''));
    } catch (e) { console.error(e); }
    setAiLoading(false);
  };

  const handleAISuggest = async () => {
    setAiLoading(true);
    try {
      const lastMsgs = messages.slice(-8).map(m => `${m.sender}: ${m.text}`).join('\n');
      const suggestion = await callGemini(`Sugiere una respuesta natural para ${config.myId} basada en:\n${lastMsgs}`, "Eres un compañero de chat.");
      if (suggestion) setInputText(suggestion.replace(/"/g, ''));
    } catch (e) { console.error(e); }
    setAiLoading(false);
  };

  const handleAISummarize = async () => {
    if (messages.length === 0) return;
    setAiLoading(true);
    try {
      const allMsgs = messages.map(m => `${m.sender}: ${m.text}`).join('\n');
      const summary = await callGemini(`Resume esta charla en 2 frases: ${allMsgs}`, "Eres un experto en resúmenes.");
      if (summary) await sendMessage(`✨ Resumen IA: ${summary}`);
    } catch (e) { console.error(e); }
    setAiLoading(false);
  };

  const handleAIGenerateImage = async () => {
    if (!inputText.trim()) return;
    setAiLoading(true);
    try {
      const imgData = await generateAIImage(inputText);
      if (imgData) {
        await sendMessage(imgData, 'image');
        setInputText("");
      }
    } catch (e) { console.error(e); }
    setAiLoading(false);
  };

  // Interfaz de Carga Inicial
  if (loading) return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="animate-pulse text-blue-500 font-bold tracking-widest uppercase">Encriptando entorno...</div>
    </div>
  );

  // VISTA DE LOGIN
  if (view === 'login') return (
    <div className="min-h-screen bg-black text-white p-6 flex flex-col justify-center font-sans">
      <div className="max-w-sm mx-auto w-full bg-zinc-900 border border-zinc-800 p-8 rounded-3xl shadow-2xl">
        <ShieldCheck className="w-12 h-12 text-blue-500 mb-4 mx-auto" />
        <h1 className="text-2xl font-bold text-center mb-6">Acceso Seguro</h1>
        <form onSubmit={handleSaveConfig} className="space-y-4">
          {!remembered ? (
            <>
              <input className="w-full bg-black border border-zinc-700 p-3 rounded-xl focus:border-blue-500 outline-none" placeholder="Tu ID Público" value={config.myId} onChange={e => setConfig({...config, myId: e.target.value})} required />
              <input className="w-full bg-black border border-zinc-700 p-3 rounded-xl focus:border-blue-500 outline-none" placeholder="ID del Destinatario" value={config.partnerId} onChange={e => setConfig({...config, partnerId: e.target.value})} required />
            </>
          ) : (
            <div className="p-3 bg-black/50 border border-zinc-800 rounded-xl flex justify-between items-center mb-2">
              <div className="text-sm">
                <span className="text-zinc-500">Sesión:</span> <span className="text-blue-400 font-mono">{config.myId}</span>
              </div>
              <button type="button" onClick={handleResetUser} className="text-[10px] text-zinc-600 hover:text-red-400 uppercase font-bold tracking-tighter">Cambiar</button>
            </div>
          )}
          <input type="password" className="w-full bg-black border border-zinc-700 p-3 rounded-xl focus:border-blue-500 outline-none" placeholder="Frase Maestra de Descifrado" value={config.secret} onChange={e => setConfig({...config, secret: e.target.value})} required autoFocus={remembered} />
          <button className="w-full bg-blue-600 hover:bg-blue-500 py-4 rounded-xl font-bold transition-all shadow-lg active:scale-95">Abrir Chat Seguro</button>
        </form>
      </div>
    </div>
  );

  // VISTA DEL CHAT PRINCIPAL
  return (
    <div className="flex flex-col h-screen bg-black text-white max-w-2xl mx-auto border-x border-zinc-800">
      {/* CABECERA */}
      <header className="p-4 bg-zinc-900/90 backdrop-blur-md border-b border-zinc-800 flex justify-between items-center sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 bg-blue-600/20 rounded-full flex items-center justify-center border border-blue-500/30">
              <User className="w-5 h-5 text-blue-400" />
            </div>
            {sentiment && (
              <div className="absolute -bottom-1 -right-1 bg-zinc-950 rounded-full text-xs p-0.5 border border-zinc-800 shadow-lg" title="Vibra detectada por IA ✨">
                {sentiment}
              </div>
            )}
          </div>
          <div>
            <h3 className="font-bold text-sm truncate max-w-[150px]">{config.partnerId}</h3>
            <p className="text-[10px] text-emerald-500 flex items-center gap-1 font-bold"><Lock className="w-2 h-2" /> CIFRADO ACTIVADO</p>
          </div>
        </div>
        <div className="flex gap-1 items-center">
          <button onClick={handleAITranslate} className="p-2 hover:bg-zinc-800 rounded-full text-zinc-400 transition-colors" title="Traducir último mensaje ✨">
            <Languages className="w-5 h-5" />
          </button>
          <button onClick={handleAISummarize} className="p-2 hover:bg-zinc-800 rounded-full text-blue-400 transition-colors" title="Resumir charla ✨">
            <BrainCircuit className="w-5 h-5" />
          </button>
          <div className="w-px h-6 bg-zinc-800 mx-1"></div>
          <button onClick={handleLogout} className="p-2 hover:bg-zinc-800 rounded-full text-zinc-500 transition-colors" title="Cerrar"><LogOut className="w-5 h-5" /></button>
        </div>
      </header>

      {/* ÁREA DE MENSAJES */}
      <main className="flex-1 overflow-y-auto p-4 space-y-4 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-zinc-900/20 via-black to-black">
        {messages.map(m => (
          <div key={m.id} className={`flex ${m.sender === config.myId ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm shadow-xl transition-all ${m.sender === config.myId ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-zinc-800 text-zinc-100 rounded-tl-none border border-zinc-700'}`}>
              {m.type === 'image' ? (
                <img src={m.text} alt="Cifrada" className="rounded-lg max-w-full cursor-pointer hover:brightness-110 shadow-inner" onClick={() => window.open(m.text)} />
              ) : m.type === 'audio' ? (
                <div className="flex items-center gap-3 py-1">
                  <Mic className="w-4 h-4 text-white" />
                  <audio controls src={m.text} className="h-8 max-w-[160px] md:max-w-[200px]" />
                </div>
              ) : (
                <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
              )}
              <div className="text-[9px] mt-1.5 opacity-50 text-right font-mono flex items-center justify-end gap-1">
                {m.sender === config.myId && <ShieldCheck className="w-2.5 h-2.5" />}
                {m.time?.toDate().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
              </div>
            </div>
          </div>
        ))}
        {aiLoading && (
          <div className="flex justify-center py-2">
            <div className="flex items-center gap-2 px-4 py-2 bg-zinc-900/50 rounded-full border border-zinc-800 text-blue-400 text-xs animate-pulse">
              <Sparkles className="w-3 h-3" />
              <span>Gemini está procesando...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* PIE DE PÁGINA (HERRAMIENTAS E INPUT) */}
      <footer className="p-4 bg-zinc-900/50 border-t border-zinc-800 space-y-3 backdrop-blur-lg">
        {/* Barra de herramientas IA */}
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          <button onClick={handleAISuggest} className="text-[10px] bg-blue-900/20 hover:bg-blue-900/30 px-3 py-1.5 rounded-full flex items-center gap-1.5 text-blue-400 border border-blue-500/20 whitespace-nowrap active:scale-95">
            <Sparkles className="w-3 h-3" /> ✨ Sugerir
          </button>
          <button onClick={() => handleAIPolish('profesional')} className="text-[10px] bg-emerald-900/20 hover:bg-emerald-900/30 px-3 py-1.5 rounded-full flex items-center gap-1.5 text-emerald-400 border border-emerald-500/20 whitespace-nowrap active:scale-95">
            <Wand2 className="w-3 h-3" /> ✨ Pulir Profesional
          </button>
          <button onClick={() => handleAIPolish('divertido')} className="text-[10px] bg-amber-900/20 hover:bg-amber-900/30 px-3 py-1.5 rounded-full flex items-center gap-1.5 text-amber-400 border border-amber-500/20 whitespace-nowrap active:scale-95">
            <Smile className="w-3 h-3" /> ✨ Pulir Divertido
          </button>
        </div>
        
        <div className="flex items-end gap-2">
          {/* Controles de multimedia */}
          <div className="flex gap-1 mb-1">
            <button type="button" onClick={() => fileInputRef.current?.click()} className="p-3 bg-zinc-800 hover:bg-zinc-700 rounded-2xl text-zinc-400 border border-zinc-700 active:scale-90" title="Cámara">
              <Camera className="w-5 h-5" />
            </button>
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*" className="hidden" />
            
            <button onClick={isRecording ? stopRecording : startRecording} className={`p-3 rounded-2xl transition-all active:scale-90 ${isRecording ? 'bg-red-600 text-white animate-pulse' : 'bg-zinc-800 text-zinc-400 border border-zinc-700'}`} title="Grabar">
              {isRecording ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
          </div>

          {/* Input de texto y botón de Imagen IA */}
          <div className="flex-1 relative flex items-center">
            <textarea 
              rows={1}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl px-5 py-3.5 text-sm focus:ring-2 focus:ring-blue-600 outline-none pr-12 resize-none no-scrollbar" 
              placeholder={isRecording ? "Grabando..." : "Mensaje o prompt de imagen..."} 
              value={inputText} 
              onChange={e => setInputText(e.target.value)}
              disabled={isRecording}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if(inputText.trim()) { sendMessage(inputText); setInputText(""); }
                }
              }}
            />
            <button 
              type="button" 
              onClick={handleAIGenerateImage} 
              className={`absolute right-4 transition-all ${inputText.trim() ? 'text-purple-400 scale-110' : 'text-zinc-600 opacity-50'}`} 
              disabled={!inputText.trim()}
              title="Generar Imagen IA"
            >
              <ImageIcon className="w-6 h-6" />
            </button>
          </div>

          {/* Botón de envío */}
          <button 
            onClick={(e) => { e.preventDefault(); if(inputText.trim()) { sendMessage(inputText); setInputText(""); } }}
            disabled={(!inputText.trim() && !isRecording) || aiLoading} 
            className="bg-blue-600 disabled:bg-zinc-800 w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg active:scale-90 mb-0.5"
          >
            <Send className="w-5 h-5 text-white" />
          </button>
        </div>
      </footer>
    </div>
  );
}