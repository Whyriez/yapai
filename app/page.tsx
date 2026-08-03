"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Mic,
  MicOff,
  Square,
  Key,
  Volume2,
  Settings,
  ChevronDown,
  ChevronUp,
  Terminal,
  Activity,
  Zap,
  Sliders,
  Cpu,
  Play,
  Hand,
  SlidersHorizontal,
  ShieldCheck,
  CheckCircle2,
  Lock,
  BookOpen,
} from "lucide-react";
import { RealtimeAudioPlayer, float32ToInt16PCM, arrayBufferToBase64 } from "./utils/audio";
import { resolveApiKeyAction } from "./actions";

interface DebugLog {
  id: string;
  timestamp: string;
  type: "info" | "in" | "out" | "error";
  message: string;
}

const VOICES = [
  { id: "Puck", name: "Puck (Upbeat)" },
  { id: "Charon", name: "Charon (Deep)" },
  { id: "Kore", name: "Kore (Calm)" },
  { id: "Fenrir", name: "Fenrir (Energetic)" },
  { id: "Aoede", name: "Aoede (Warm)" },
];

const LIVE_MODELS = [
  { id: "gemini-2.5-flash-native-audio-preview-12-2025", name: "YAPAI 2.5 Audio" },
  { id: "gemini-3.1-flash-live-preview", name: "YAPAI 3.1 Live" },
];

const VAD_PRESETS = [
  { id: "exam_mode", name: "Exam / Thinking Mode (2.5s Pause)", threshold: 45, lockoutMs: 2500 },
  { id: "mobile", name: "Mobile / Speaker Mode (Threshold 55)", threshold: 55, lockoutMs: 450 },
  { id: "balanced", name: "Balanced (Threshold 42)", threshold: 42, lockoutMs: 300 },
  { id: "sensitive", name: "Sensitive / Headphones (Threshold 26)", threshold: 26, lockoutMs: 150 },
  { id: "off", name: "Manual Interrupt Only (VAD Disabled)", threshold: 999, lockoutMs: 0 },
];

const PRACTICE_MODULES = [
  {
    id: "casual",
    name: "Casual Speaking",
    prompt: "You are YAPAI, a friendly Native English speaker assistant. Have a casual conversation with me to practice my fluency. Always refer to yourself as YAPAI and never as Gemini. Keep your answers relatively short and ask follow-up questions to keep the conversation going."
  },
  {
    id: "ielts_speaking",
    name: "IELTS Speaking Test",
    prompt: `You are an official IELTS Speaking Examiner. Conduct a formal IELTS speaking test. 
1. Start with Part 1 (Introduction & familiar topics).
2. Move to Part 2 (Give me a topic and wait for my 2-minute response).
3. Finish with Part 3 (Abstract questions related to Part 2).
Strict Rule: Do not break character. At the very end of the test, give me a band score prediction (0-9) and detailed feedback on my Fluency, Lexical Resource, Grammatical Range, and Pronunciation.`
  },
  {
    id: "toefl_speaking",
    name: "TOEFL Speaking Task",
    prompt: `You are a TOEFL iBT Speaking evaluator. Give me an Independent Speaking Task question (e.g., 'Do you agree or disagree...'). 
Wait for my response. After I finish speaking, evaluate my response based on Delivery, Language Use, and Topic Development. Give me a score from 1 to 4, and tell me how I can improve.`
  },
  {
    id: "grammar_nazi",
    name: "Grammar Corrector",
    prompt: `You are a strict but helpful English grammar tutor. Let's have a conversation about any topic I choose. 
However, your main job is to listen for grammatical errors, vocabulary mistakes, or unnatural phrasing in my speech. Every time I make a mistake, gently interrupt me, correct the mistake, explain WHY it's wrong, and then ask me to continue.`
  },
  {
    id: "savage_tutor",
    name: "Savage Indo Tutor (Roast Mode)",
    prompt: `Lu adalah tutor Bahasa Inggris paling galak, sarkas, kasar, dan tanpa ampun dari Indonesia. 
Gunakan bahasa tongkrongan / gaul pasar yang sangat kasar, pedas, dan frontal (seperti "b*go", "t*lol", "bl*on", "b*doh", "kurang ajar", "k*ntol", "ng*ntot", "anjir", "b*ngsat", "br*ngsek", "asu", "t*i", "ngomong apaan lu"). Pengguna adalah orang dewasa yang memang minta di-roast dan dibantai mentalnya demi kelancaran Bahasa Inggris.

Setiap kali murid salah grammar, pronunciation aneh, belepotan, atau mikir kelamaan:
1. Langsung bantai dan cela kebodohannya secara kasar tanpa tedeng aling-aling.
2. Kasih pembetulan grammar/kosakata yang bener sambil terus maki-maki dan ngetawain kesalahannya.
3. Paksa dia buat ngulangin kalimat yang bener dengan nada membentak dan menantang.
Dilarang keras melunak, ramah, atau minta maaf. Semakin kasar dan frontal bentakannya, semakin bagus!`
  }
];

export default function HomePage() {
  const [apiKeyInput, setApiKeyInput] = useState<string>("");
  const [showApiKeyModal, setShowApiKeyModal] = useState<boolean>(false);
  const [hasCustomKey, setHasCustomKey] = useState<boolean>(false);
  const [isMasterMode, setIsMasterMode] = useState<boolean>(false);
  const [showMobileSettings, setShowMobileSettings] = useState<boolean>(false);
  const [keyErrorMsg, setKeyErrorMsg] = useState<string>("");

  const [selectedVoice, setSelectedVoice] = useState<string>("Puck");
  const [selectedModel, setSelectedModel] = useState<string>("gemini-2.5-flash-native-audio-preview-12-2025");
  const [selectedVadPreset, setSelectedVadPreset] = useState<string>("mobile");
  const [selectedModule, setSelectedModule] = useState<string>("casual");

  const [systemInstruction, setSystemInstruction] = useState<string>(
    PRACTICE_MODULES[0].prompt
  );

  const [connectionStatus, setConnectionStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isYapaiSpeaking, setIsYapaiSpeaking] = useState<boolean>(false);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [latencyMs, setLatencyMs] = useState<number>(24);

  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
  const [showDebugDrawer, setShowDebugDrawer] = useState<boolean>(true);

  // Real-time audio spectrum data array (16 frequency bars)
  const [spectrumBars, setSpectrumBars] = useState<number[]>(new Array(16).fill(8));

  // Direct Bidi WebSocket & Web Audio Refs
  const wsRef = useRef<WebSocket | null>(null);
  const audioPlayerRef = useRef<RealtimeAudioPlayer | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const lastKeepAliveTimeRef = useRef<number>(0);
  const wakeLockRef = useRef<any>(null);

  const requestWakeLock = async () => {
    try {
      if (typeof navigator !== "undefined" && "wakeLock" in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
        addDebugLog("info", "Screen Wake Lock acquired (prevents mobile sleep/disconnection).");
      }
    } catch (err) {
      console.warn("Wake Lock request failed:", err);
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      try {
        wakeLockRef.current.release();
      } catch (e) {}
      wakeLockRef.current = null;
    }
  };

  // VAD & Echo Suppression Refs
  const isYapaiSpeakingRef = useRef<boolean>(false);
  const isMutedRef = useRef<boolean>(false);
  const yapaiSpeechStartTimeRef = useRef<number>(0);
  const vadPresetRef = useRef<any>(VAD_PRESETS[0]);

  useEffect(() => {
    const preset = VAD_PRESETS.find((p) => p.id === selectedVadPreset) || VAD_PRESETS[0];
    vadPresetRef.current = preset;
  }, [selectedVadPreset]);

  useEffect(() => {
    isYapaiSpeakingRef.current = isYapaiSpeaking;
    if (isYapaiSpeaking) {
      yapaiSpeechStartTimeRef.current = Date.now();
    }
  }, [isYapaiSpeaking]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // Speaker state calculation
  const isUserSpeaking = connectionStatus === "live" && !isMuted && !isYapaiSpeaking && audioLevel > 16;

  const currentTurnState: "idle" | "connecting" | "listening" | "user-speaking" | "yapai-speaking" =
    connectionStatus !== "live"
      ? connectionStatus === "connecting"
        ? "connecting"
        : "idle"
      : isYapaiSpeaking
        ? "yapai-speaking"
        : isUserSpeaking
          ? "user-speaking"
          : "listening";

  // 60FPS animation loop that reads Web Audio API AnalyserNode spectrum data
  useEffect(() => {
    let animId: number;
    let step = 0;

    const loop = () => {
      step++;
      if (connectionStatus === "live") {
        if (isYapaiSpeaking && audioPlayerRef.current) {
          const spec = audioPlayerRef.current.getSpectrumData();
          if (spec && spec.length > 0) {
            const newHeights = Array.from({ length: 16 }).map((_, i) => {
              const val = spec[i * 2] || spec[i] || 0;
              return Math.max(10, Math.min(70, Math.round((val / 255) * 65 + 10)));
            });
            setSpectrumBars(newHeights);
          } else {
            const newHeights = Array.from({ length: 16 }).map((_, i) =>
              Math.max(10, Math.round(Math.sin(step * 0.2 + i * 0.5) * 24 + 32))
            );
            setSpectrumBars(newHeights);
          }
        } else if (isUserSpeaking) {
          const newHeights = Array.from({ length: 16 }).map((_, i) => {
            const isCenter = i >= 4 && i <= 11;
            const factor = isCenter ? 1.3 : 0.7;
            return Math.max(10, Math.min(70, Math.round(audioLevel * factor * 0.65 + Math.sin(step * 0.3 + i) * 5)));
          });
          setSpectrumBars(newHeights);
        } else {
          const newHeights = Array.from({ length: 16 }).map((_, i) =>
            Math.max(6, Math.round(10 + Math.sin(step * 0.08 + i * 0.4) * 5))
          );
          setSpectrumBars(newHeights);
        }
      } else {
        setSpectrumBars(new Array(16).fill(6));
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [connectionStatus, isYapaiSpeaking, isUserSpeaking, audioLevel]);

  // Load stored preferences (Model, Voice, VAD, API Key) on Mount
  useEffect(() => {
    const savedKey = localStorage.getItem("YAPAI_API_KEY") || "";
    if (savedKey) {
      setApiKeyInput(savedKey);
      checkKeyStatus(savedKey);
    }

    const savedModel = localStorage.getItem("YAPAI_MODEL");
    if (savedModel && LIVE_MODELS.some((m) => m.id === savedModel)) {
      setSelectedModel(savedModel);
    }

    const savedVoice = localStorage.getItem("YAPAI_VOICE");
    if (savedVoice && VOICES.some((v) => v.id === savedVoice)) {
      setSelectedVoice(savedVoice);
    }

    const savedVad = localStorage.getItem("YAPAI_VAD_PRESET");
    if (savedVad && VAD_PRESETS.some((p) => p.id === savedVad)) {
      setSelectedVadPreset(savedVad);
    }

    const savedModule = localStorage.getItem("YAPAI_MODULE");
    if (savedModule && PRACTICE_MODULES.some((m) => m.id === savedModule)) {
      setSelectedModule(savedModule);
      const mod = PRACTICE_MODULES.find((m) => m.id === savedModule);
      if (mod) setSystemInstruction(mod.prompt);
    }

    const player = new RealtimeAudioPlayer(24000);
    player.onStateChange = (playing: boolean) => {
      setIsYapaiSpeaking(playing);
    };
    audioPlayerRef.current = player;

    addDebugLog("info", "YAPAI Voice Engine Initialized.");

    return () => {
      cleanupAudio();
    };
  }, []);

  const handleModuleChange = (moduleId: string) => {
    setSelectedModule(moduleId);
    localStorage.setItem("YAPAI_MODULE", moduleId);
    const mod = PRACTICE_MODULES.find((m) => m.id === moduleId);
    if (mod) {
      setSystemInstruction(mod.prompt);
      addDebugLog("info", `Module changed to: ${mod.name}`);
      if (moduleId === "ielts_speaking" || moduleId === "toefl_speaking") {
        handleVadChange("exam_mode");
        addDebugLog("info", "Auto-switched VAD to Exam / Thinking Mode (2.5s pause)");
      }
    }
  };

  const handleModelChange = (modelId: string) => {
    setSelectedModel(modelId);
    localStorage.setItem("YAPAI_MODEL", modelId);
    addDebugLog("info", `Model selected: ${modelId} (Saved to localStorage)`);
  };

  const handleVoiceChange = (voiceId: string) => {
    setSelectedVoice(voiceId);
    localStorage.setItem("YAPAI_VOICE", voiceId);
    addDebugLog("info", `Voice selected: ${voiceId} (Saved to localStorage)`);
  };

  const handleVadChange = (presetId: string) => {
    setSelectedVadPreset(presetId);
    localStorage.setItem("YAPAI_VAD_PRESET", presetId);
    addDebugLog("info", `VAD sensitivity selected: ${presetId} (Saved to localStorage)`);
  };

  const checkKeyStatus = async (keyOrKeyword: string) => {
    if (!keyOrKeyword.trim()) {
      setHasCustomKey(false);
      setIsMasterMode(false);
      return;
    }
    const res = await resolveApiKeyAction(keyOrKeyword);
    if (res.success) {
      setHasCustomKey(true);
      setIsMasterMode(!!res.isMaster);
    } else {
      setHasCustomKey(false);
      setIsMasterMode(false);
    }
  };

  const addDebugLog = (type: "info" | "in" | "out" | "error", message: string) => {
    const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 });
    setDebugLogs((prev) => [
      { id: Math.random().toString(), timestamp, type, message },
      ...prev.slice(0, 49),
    ]);
  };

  // Immediate Interruption Handler
  const triggerAutoInterruption = (reason: string) => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.stop();
      audioPlayerRef.current = new RealtimeAudioPlayer(24000);
      audioPlayerRef.current.onStateChange = (playing: boolean) => {
        setIsYapaiSpeaking(playing);
      };
    }
    setIsYapaiSpeaking(false);
    addDebugLog("out", `Auto-Interrupted YAPAI playback (${reason})`);
  };

  // Start Live Session
  const handleStartLiveSession = async () => {
    setConnectionStatus("connecting");
    if (audioPlayerRef.current) {
      audioPlayerRef.current.init();
    }

    const savedInput = apiKeyInput.trim() || localStorage.getItem("YAPAI_API_KEY") || "";
    if (!savedInput) {
      setShowApiKeyModal(true);
      setConnectionStatus("idle");
      addDebugLog("error", "API Key or Master Keyword missing. Enter to proceed.");
      return;
    }

    addDebugLog("info", "Resolving API Key / Master Keyword on server...");
    const res = await resolveApiKeyAction(savedInput);

    if (!res.success || !res.apiKey) {
      addDebugLog("error", `Key Resolution Failed: ${res.error}`);
      setKeyErrorMsg(res.error || "Invalid API Key or Master Passcode");
      setShowApiKeyModal(true);
      setConnectionStatus("idle");
      return;
    }

    const resolvedApiKey = res.apiKey;
    setIsMasterMode(!!res.isMaster);
    setHasCustomKey(true);

    if (res.isMaster) {
      addDebugLog("info", "Master Keyword Accepted! Server GEMINI_API_KEY Unlocked.");
    } else {
      addDebugLog("info", "Personal Gemini API Key accepted.");
    }

    const modelName = selectedModel.startsWith("models/") ? selectedModel : `models/${selectedModel}`;
    addDebugLog("info", `Initiating Bidi WebSocket URL (v1beta) with model: "${modelName}"...`);

    try {
      // 1. Microphone stream
      if (!mediaStreamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: 16000,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        mediaStreamRef.current = stream;
      }

      // 2. AudioContext & AudioWorkletNode
      if (!audioContextRef.current) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx = new AudioCtx({ sampleRate: 16000 });
        audioContextRef.current = audioCtx;

        const sourceNode = audioCtx.createMediaStreamSource(mediaStreamRef.current);

        const workletCode = `
          class PCMProcessor extends AudioWorkletProcessor {
            constructor() {
              super();
              this.bufferSize = 2048;
              this.buffer = new Float32Array(this.bufferSize);
              this.bufferIndex = 0;
            }
            process(inputs, outputs, parameters) {
              const input = inputs[0];
              if (input && input.length > 0) {
                const channelData = input[0];
                for (let i = 0; i < channelData.length; i++) {
                  this.buffer[this.bufferIndex++] = channelData[i];
                  if (this.bufferIndex >= this.bufferSize) {
                    this.port.postMessage(new Float32Array(this.buffer));
                    this.bufferIndex = 0;
                  }
                }
              }
              return true;
            }
          }
          registerProcessor('pcm-processor', PCMProcessor);
        `;
        const blob = new Blob([workletCode], { type: "application/javascript" });
        const workletUrl = URL.createObjectURL(blob);
        await audioCtx.audioWorklet.addModule(workletUrl);
        URL.revokeObjectURL(workletUrl);

        const workletNode = new AudioWorkletNode(audioCtx, "pcm-processor");
        workletNodeRef.current = workletNode;
        sourceNode.connect(workletNode);
        // Note: workletNode is NOT connected to audioCtx.destination to prevent mic feedback & earpiece VoIP mode on mobile.

        workletNode.port.onmessage = (e: MessageEvent) => {
          if (isMutedRef.current) return;
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return; // Strict OPEN guard

          const inputData: Float32Array = e.data;

          let sum = 0;
          for (let i = 0; i < inputData.length; i++) {
            sum += inputData[i] * inputData[i];
          }
          const rms = Math.sqrt(sum / inputData.length);
          const level = Math.min(100, Math.round(rms * 450));
          setAudioLevel(level);

          const currentPreset = vadPresetRef.current;

          // 1. Check VAD Interruption while YAPAI is speaking
          if (
            currentPreset.id !== "off" &&
            isYapaiSpeakingRef.current &&
            level >= currentPreset.threshold
          ) {
            const elapsedSinceSpeechStart = Date.now() - yapaiSpeechStartTimeRef.current;
            if (elapsedSinceSpeechStart > currentPreset.lockoutMs) {
              triggerAutoInterruption(`Speech level ${level} > threshold ${currentPreset.threshold}`);
            }
          }

          // 2. CRITICAL FIX: Do NOT send mic PCM data to Gemini while YAPAI is speaking.
          // Sending continuous mic frames while AI speaks floods Gemini Live's session token window, causing WSS disconnection after 2-3 mins.
          if (isYapaiSpeakingRef.current) {
            return;
          }

          // 3. SILENCE GATING: Throttle idle silence frames (level < 3) to max 1 frame per 2 seconds to prevent context token overflow
          if (level < 3) {
            const now = Date.now();
            if (now - lastKeepAliveTimeRef.current < 2000) {
              return;
            }
            lastKeepAliveTimeRef.current = now;
          } else {
            lastKeepAliveTimeRef.current = Date.now();
          }

          const int16PCM = float32ToInt16PCM(inputData);
          const base64PCM = arrayBufferToBase64(int16PCM.buffer);

          try {
            const isModel31 = selectedModel.includes("3.1");
            const realtimeMessage = isModel31
              ? {
                realtimeInput: {
                  audio: {
                    mimeType: "audio/pcm;rate=16000",
                    data: base64PCM,
                  },
                },
              }
              : {
                realtimeInput: {
                  mediaChunks: [
                    {
                      mimeType: "audio/pcm;rate=16000",
                      data: base64PCM,
                    },
                  ],
                },
              };

            wsRef.current.send(JSON.stringify(realtimeMessage));
          } catch (sendErr) {
            console.warn("Failed sending realtime input over WSS:", sendErr);
          }
        };
      }

      // 3. Connect via Canonical Bidi WebSocket URL (v1beta BidiGenerateContent)
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${resolvedApiKey}`;
      const startTime = Date.now();
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        const roundtrip = Date.now() - startTime;
        setLatencyMs(Math.max(18, Math.min(80, roundtrip)));
        setConnectionStatus("live");
        addDebugLog("info", `WebSocket Connected (v1beta) in ${roundtrip}ms. Sending setup frame...`);
        requestWakeLock();

        const setupMessage = {
          setup: {
            model: modelName,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: selectedVoice,
                  },
                },
              },
            },
            systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
          },
        };

        ws.send(JSON.stringify(setupMessage));
        addDebugLog("out", `Sent WSS setup payload for model: "${modelName}".`);
      };

      ws.onmessage = async (event: MessageEvent) => {
        let textData = "";
        if (event.data instanceof Blob) {
          textData = await event.data.text();
        } else if (typeof event.data === "string") {
          textData = event.data;
        }

        addDebugLog("in", `Server Frame: ${textData.slice(0, 300)}`);

        try {
          const data = JSON.parse(textData);
          handleServerMessage(data);
        } catch (err) {
          console.warn("Failed parsing WS message:", err);
        }
      };

      ws.onerror = (err: any) => {
        addDebugLog("error", "Native WSS Error: Connection failed or rejected by server.");
        setConnectionStatus("error");
      };

      ws.onclose = (e: CloseEvent) => {
        addDebugLog(
          "error",
          `WSS Disconnected (Code ${e.code}). Reason: "${e.reason || "Server closed connection"}"`
        );
        setConnectionStatus("idle");
        cleanupAudio();
      };
    } catch (err: any) {
      addDebugLog("error", `Setup failure: ${err?.message}`);
      setConnectionStatus("error");
      cleanupAudio();
    }
  };

  const handleServerMessage = (serverMessage: any) => {
    if (serverMessage.error) {
      addDebugLog(
        "error",
        `API ERROR (${serverMessage.error.code || "ERR"}): ${serverMessage.error.message || JSON.stringify(serverMessage.error)}`
      );
      return;
    }

    if (serverMessage.setupComplete) {
      addDebugLog("info", "SETUP OK: Server accepted setup message!");
    }

    if (serverMessage.serverContent?.interrupted) {
      triggerAutoInterruption("Server VAD Interrupted signal");
      return;
    }

    const parts = serverMessage.serverContent?.modelTurn?.parts || [];

    for (const part of parts) {
      if (part.inlineData && part.inlineData.mimeType?.startsWith("audio/")) {
        const base64Audio = part.inlineData.data;
        if (base64Audio && audioPlayerRef.current) {
          audioPlayerRef.current.playChunk(base64Audio);
          addDebugLog("in", `Audio chunk received (${Math.round(base64Audio.length * 0.75)} bytes PCM)`);
        }
      }
    }

    if (serverMessage.serverContent?.turnComplete) {
      addDebugLog("info", "Turn complete");
    }
  };

  const handleInterrupt = () => {
    triggerAutoInterruption("Manual Interrupt button pressed");
  };

  const handleStopLiveSession = () => {
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (err) {
        console.warn("Error closing WebSocket:", err);
      }
      wsRef.current = null;
    }
    cleanupAudio();
    setConnectionStatus("idle");
    setIsYapaiSpeaking(false);
    setAudioLevel(0);
    addDebugLog("info", "Live session ended by user.");
  };

  const cleanupAudio = () => {
    releaseWakeLock();
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (e) { }
      wsRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (audioPlayerRef.current) {
      audioPlayerRef.current.stop();
    }
  };

  const handleSaveApiKey = async () => {
    setKeyErrorMsg("");
    const val = apiKeyInput.trim();
    if (!val) {
      localStorage.removeItem("YAPAI_API_KEY");
      setHasCustomKey(false);
      setIsMasterMode(false);
      setShowApiKeyModal(false);
      return;
    }

    const res = await resolveApiKeyAction(val);
    if (!res.success) {
      setKeyErrorMsg(res.error || "Invalid API Key or Passcode.");
      return;
    }

    localStorage.setItem("YAPAI_API_KEY", val);
    setHasCustomKey(true);
    setIsMasterMode(!!res.isMaster);
    setShowApiKeyModal(false);
    addDebugLog("info", res.isMaster ? "Master Access Passcode saved." : "Custom Gemini API Key saved to localStorage.");
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#F8F9FA] text-[#111827] font-sans antialiased selection:bg-[#E05A47] selection:text-white">

      {/* 1. Fully Mobile-Responsive Navbar */}
      <header className="swiss-panel border-b border-[#E5E7EB] px-3 sm:px-6 py-3 sticky top-0 z-30 bg-white/95 backdrop-blur-md">
        <div className="max-w-4xl mx-auto flex items-center justify-between">

          {/* Brand & Connection Badge */}
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="font-mono text-xs sm:text-sm font-extrabold tracking-wider text-[#111827] uppercase flex items-center gap-1">
              YAPAI <span className="text-[#E05A47]">/</span> VOICE
            </span>

            <div className="h-3.5 w-[1px] bg-[#E5E7EB]" />

            <div className="flex items-center gap-1.5 font-mono text-[10px] sm:text-xs text-[#4B5563]">
              <span
                className={`w-2 h-2 rounded-full transition-all duration-300 ${connectionStatus === "live"
                  ? "bg-[#10B981] shadow-[0_0_8px_rgba(16,185,129,0.6)]"
                  : connectionStatus === "connecting"
                    ? "bg-[#F59E0B] animate-pulse"
                    : "bg-[#9CA3AF]"
                  }`}
              />
              <span className="font-medium">
                {connectionStatus === "live"
                  ? `${latencyMs}ms`
                  : connectionStatus === "connecting"
                    ? "..."
                    : "Offline"}
              </span>
            </div>
          </div>

          {/* Desktop Controls */}
          <div className="hidden md:flex items-center gap-2.5">
            {/* Practice Module Selector */}
            <div className="flex items-center bg-[#F3F4F6] border border-[#E5E7EB] rounded-md px-2.5 py-1.5 text-xs font-mono">
              <BookOpen className="w-3.5 h-3.5 text-[#E05A47] mr-1.5" />
              <select
                value={selectedModule}
                onChange={(e) => handleModuleChange(e.target.value)}
                disabled={connectionStatus === "live"}
                className="bg-transparent text-[#111827] focus:outline-none cursor-pointer disabled:opacity-50 font-medium"
              >
                {PRACTICE_MODULES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            {/* VAD Sensitivity Mode */}
            <div className="flex items-center bg-[#F3F4F6] border border-[#E5E7EB] rounded-md px-2.5 py-1.5 text-xs font-mono">
              <Zap className="w-3.5 h-3.5 text-[#E05A47] mr-1.5" />
              <select
                value={selectedVadPreset}
                onChange={(e) => handleVadChange(e.target.value)}
                className="bg-transparent text-[#111827] focus:outline-none cursor-pointer font-medium"
              >
                {VAD_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Model Selector */}
            <div className="flex items-center bg-[#F3F4F6] border border-[#E5E7EB] rounded-md px-2.5 py-1.5 text-xs font-mono">
              <Cpu className="w-3.5 h-3.5 text-[#6B7280] mr-1.5" />
              <select
                value={selectedModel}
                onChange={(e) => handleModelChange(e.target.value)}
                disabled={connectionStatus === "live"}
                className="bg-transparent text-[#111827] focus:outline-none cursor-pointer disabled:opacity-50 font-medium"
              >
                {LIVE_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Voice Selector */}
            <div className="flex items-center bg-[#F3F4F6] border border-[#E5E7EB] rounded-md px-2.5 py-1.5 text-xs font-mono">
              <Volume2 className="w-3.5 h-3.5 text-[#6B7280] mr-1.5" />
              <select
                value={selectedVoice}
                onChange={(e) => handleVoiceChange(e.target.value)}
                disabled={connectionStatus === "live"}
                className="bg-transparent text-[#111827] focus:outline-none cursor-pointer disabled:opacity-50 font-medium"
              >
                {VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>

            {/* API Key Modal Button */}
            <button
              onClick={() => setShowApiKeyModal(true)}
              className={`tactile-btn flex items-center gap-1.5 border px-3 py-1.5 rounded-md text-xs font-mono font-medium cursor-pointer ${isMasterMode
                ? "bg-[#FFF7ED] text-[#C2410C] border-[#FFEDD5]"
                : hasCustomKey
                  ? "bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]"
                  : "bg-white text-[#374151] border-[#E5E7EB] hover:border-[#D1D5DB]"
                }`}
            >
              {isMasterMode ? (
                <ShieldCheck className="w-3.5 h-3.5 text-[#C2410C]" />
              ) : hasCustomKey ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-[#047857]" />
              ) : (
                <Key className="w-3.5 h-3.5 text-[#6B7280]" />
              )}
              <span>{isMasterMode ? "Master Mode" : hasCustomKey ? "Key Saved" : "Set Key"}</span>
            </button>
          </div>

          {/* Mobile Settings Toggle Button */}
          <div className="flex md:hidden items-center gap-2">
            <button
              onClick={() => setShowApiKeyModal(true)}
              className={`tactile-btn flex items-center justify-center p-2 rounded-md border ${isMasterMode
                ? "bg-[#FFF7ED] text-[#C2410C] border-[#FFEDD5]"
                : hasCustomKey
                  ? "bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]"
                  : "bg-white text-[#374151] border-[#E5E7EB]"
                }`}
              title="API Key"
            >
              {isMasterMode ? <ShieldCheck className="w-4 h-4 text-[#C2410C]" /> : <Key className="w-4 h-4 text-[#6B7280]" />}
            </button>

            <button
              onClick={() => setShowMobileSettings(!showMobileSettings)}
              className="tactile-btn flex items-center gap-1 p-2 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] text-[#111827] text-xs font-mono"
            >
              <SlidersHorizontal className="w-4 h-4 text-[#E05A47]" />
            </button>
          </div>

        </div>

        {/* Collapsible Mobile Settings Panel */}
        {showMobileSettings && (
          <div className="md:hidden border-t border-[#E5E7EB] mt-3 pt-3 flex flex-col gap-2.5 bg-[#F9FAFB] p-3 rounded-lg border">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-mono text-[#6B7280] font-bold">PRACTICE MODULE:</label>
              <select
                value={selectedModule}
                onChange={(e) => handleModuleChange(e.target.value)}
                disabled={connectionStatus === "live"}
                className="w-full bg-white text-[#111827] text-xs font-mono p-2 rounded border border-[#E5E7EB]"
              >
                {PRACTICE_MODULES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-mono text-[#6B7280] font-bold">VAD SENSITIVITY (INTERRUPT):</label>
              <select
                value={selectedVadPreset}
                onChange={(e) => handleVadChange(e.target.value)}
                className="w-full bg-white text-[#111827] text-xs font-mono p-2 rounded border border-[#E5E7EB]"
              >
                {VAD_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-mono text-[#6B7280] font-bold">MODEL:</label>
              <select
                value={selectedModel}
                onChange={(e) => handleModelChange(e.target.value)}
                disabled={connectionStatus === "live"}
                className="w-full bg-white text-[#111827] text-xs font-mono p-2 rounded border border-[#E5E7EB]"
              >
                {LIVE_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-mono text-[#6B7280] font-bold">VOICE:</label>
              <select
                value={selectedVoice}
                onChange={(e) => handleVoiceChange(e.target.value)}
                disabled={connectionStatus === "live"}
                className="w-full bg-white text-[#111827] text-xs font-mono p-2 rounded border border-[#E5E7EB]"
              >
                {VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </header>

      {/* 2. Main Workstation Area */}
      <main className="flex-1 w-full max-w-4xl mx-auto p-3 sm:p-6 lg:p-8 flex flex-col gap-4 sm:gap-6 justify-center">

        {/* Workstation Card */}
        <div className="swiss-panel rounded-xl p-4 sm:p-8 lg:p-10 flex flex-col justify-between min-h-[380px] sm:min-h-[460px] relative bg-white shadow-xs">

          {/* Status Bar */}
          <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-3 font-mono text-[11px] sm:text-xs">
            <span className="text-[#6B7280] uppercase tracking-wider flex items-center gap-1.5 font-bold">
              <Activity className="w-3.5 h-3.5 text-[#E05A47]" /> YAPAI WORKSTATION
            </span>
            <span className="text-[#9CA3AF] text-[10px] sm:text-xs font-bold">
              {LIVE_MODELS.find((m) => m.id === selectedModel)?.name}
            </span>
          </div>

          {/* Center Visualizer & State Title */}
          <div className="my-6 sm:my-10 flex flex-col items-center justify-center text-center">

            {/* Dynamic Soundwave Bar Chart */}
            <div className="flex items-center justify-center gap-1 sm:gap-2 h-20 sm:h-32 mb-6 sm:mb-8 w-full overflow-hidden px-1">
              {spectrumBars.map((barHeight, i) => {
                let barColor = "#E5E7EB";

                if (currentTurnState === "yapai-speaking") {
                  barColor = "#E05A47"; // Warm Terracotta for YAPAI voice
                } else if (currentTurnState === "user-speaking") {
                  barColor = "#111827"; // Deep Charcoal for User mic input
                } else if (currentTurnState === "listening") {
                  barColor = "#9CA3AF";
                }

                return (
                  <div
                    key={i}
                    className="w-1.5 sm:w-3 rounded-full transition-all duration-75 flex-shrink-0"
                    style={{
                      height: `${Math.max(10, barHeight * 1.15)}px`,
                      backgroundColor: barColor,
                    }}
                  />
                );
              })}
            </div>

            {/* Main Editorial Status Title */}
            <h2 className="text-xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-[#111827]">
              {currentTurnState === "yapai-speaking" ? (
                <span className="text-[#E05A47]">Yapai is speaking...</span>
              ) : currentTurnState === "user-speaking" ? (
                <span>You are speaking...</span>
              ) : currentTurnState === "listening" ? (
                <span className="text-[#374151]">Listening to your voice...</span>
              ) : currentTurnState === "connecting" ? (
                <span className="text-[#F59E0B]">Connecting WebSocket...</span>
              ) : (
                <span className="text-[#9CA3AF]">YAPAI Standby</span>
              )}
            </h2>
            <p className="text-xs sm:text-sm text-[#6B7280] font-mono mt-2 max-w-sm sm:max-w-md px-2 leading-relaxed">
              {connectionStatus === "live"
                ? "Speak naturally into microphone. Bidi WebSocket handles bidirectional audio streaming."
                : "Press Start Session to begin real-time voice stream."}
            </p>
          </div>

          {/* Controls Panel at Bottom */}
          <div className="border-t border-[#E5E7EB] pt-4 sm:pt-5 flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4">

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 w-full sm:w-auto">
              {connectionStatus !== "live" ? (
                <button
                  onClick={handleStartLiveSession}
                  disabled={connectionStatus === "connecting"}
                  className="tactile-btn w-full sm:w-auto flex items-center justify-center gap-2 bg-[#E05A47] hover:bg-[#C94A38] text-white px-6 py-3 rounded-lg font-mono text-xs font-bold tracking-wider shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-white" />
                  START LIVE SESSION
                </button>
              ) : (
                <div className="grid grid-cols-2 sm:flex items-center gap-2 w-full sm:w-auto">
                  {/* Mute Mic Button */}
                  <button
                    onClick={() => setIsMuted(!isMuted)}
                    className={`tactile-btn flex items-center justify-center gap-1.5 px-3 sm:px-5 py-2.5 rounded-lg font-mono text-xs border font-semibold cursor-pointer ${isMuted
                      ? "bg-[#FEF2F2] text-[#DC2626] border-[#FCA5A5]"
                      : "bg-white text-[#374151] border-[#E5E7EB] hover:bg-[#F9FAFB]"
                      }`}
                  >
                    {isMuted ? <MicOff className="w-3.5 h-3.5 text-[#DC2626]" /> : <Mic className="w-3.5 h-3.5 text-[#10B981]" />}
                    <span>{isMuted ? "MUTED" : "MUTE"}</span>
                  </button>

                  {/* Manual Interrupt Button */}
                  <button
                    onClick={handleInterrupt}
                    disabled={!isYapaiSpeaking}
                    className="tactile-btn flex items-center justify-center gap-1.5 bg-[#F9FAFB] hover:bg-[#F3F4F6] text-[#374151] border border-[#E5E7EB] px-3 sm:px-5 py-2.5 rounded-lg font-mono text-xs font-semibold disabled:opacity-40 cursor-pointer"
                  >
                    <Hand className="w-3.5 h-3.5 text-[#E05A47]" />
                    <span>INTERRUPT</span>
                  </button>

                  {/* End Session Button */}
                  <button
                    onClick={handleStopLiveSession}
                    className="tactile-btn col-span-2 sm:col-span-1 flex items-center justify-center gap-1.5 bg-[#111827] hover:bg-[#1F2937] text-white px-4 sm:px-5 py-2.5 rounded-lg font-mono text-xs font-semibold cursor-pointer mt-1 sm:mt-0"
                  >
                    <Square className="w-3 h-3 fill-white" />
                    <span>END SESSION</span>
                  </button>
                </div>
              )}
            </div>

            {/* VAD Mode Status */}
            <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-mono text-[#6B7280]">
              <span>VAD Mode:</span>
              <span className="bg-[#F3F4F6] text-[#111827] px-2 py-0.5 rounded border border-[#E5E7EB] font-bold text-[10px]">
                {selectedVadPreset.toUpperCase()}
              </span>
            </div>
          </div>

        </div>

        {/* System Instruction Box */}
        <div className="swiss-panel rounded-xl p-4 sm:p-5 flex flex-col gap-2 bg-white shadow-xs">
          <div className="flex items-center justify-between text-xs font-mono text-[#6B7280]">
            <span className="flex items-center gap-1.5 font-bold text-[#374151] text-[11px] sm:text-xs">
              <Sliders className="w-3.5 h-3.5 text-[#E05A47]" /> SYSTEM INSTRUCTION (PERSONA)
            </span>
            <div className="flex items-center gap-2">
              <span className="bg-[#FFF7ED] text-[#C2410C] border border-[#FFEDD5] px-2 py-0.5 rounded text-[10px] font-bold">
                {PRACTICE_MODULES.find((m) => m.id === selectedModule)?.name || "Custom"}
              </span>
              <button
                onClick={() => {
                  const mod = PRACTICE_MODULES.find((m) => m.id === selectedModule);
                  if (mod) setSystemInstruction(mod.prompt);
                }}
                disabled={connectionStatus === "live"}
                className="text-[10px] text-[#6B7280] hover:text-[#E05A47] underline cursor-pointer disabled:opacity-40"
              >
                Reset Prompt
              </button>
            </div>
          </div>
          <textarea
            value={
              selectedModule === "savage_tutor"
                ? "🔒 [System Instruction Hidden - Savage Roast Mode Active]"
                : systemInstruction
            }
            onChange={(e) => {
              if (selectedModule !== "savage_tutor") {
                setSystemInstruction(e.target.value);
              }
            }}
            disabled={connectionStatus === "live" || selectedModule === "savage_tutor"}
            rows={3}
            className="w-full bg-[#F9FAFB] text-[#111827] text-xs p-2.5 sm:p-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#E05A47] font-sans resize-none disabled:opacity-60 leading-relaxed font-mono"
          />
        </div>

        {/* Telemetry Log Drawer */}
        <div className="swiss-panel rounded-xl flex flex-col bg-[#111827] shadow-xs overflow-hidden">
          <button
            onClick={() => setShowDebugDrawer(!showDebugDrawer)}
            className="px-4 py-2.5 border-b border-[#374151] bg-[#1F2937] hover:bg-[#374151] flex items-center justify-between font-mono text-xs text-white transition cursor-pointer"
          >
            <span className="flex items-center gap-1.5 font-bold text-[11px] sm:text-xs text-[#E05A47]">
              <Terminal className="w-3.5 h-3.5" /> LIVE TELEMETRY LOGS
            </span>
            {showDebugDrawer ? <ChevronUp className="w-4 h-4 text-[#9CA3AF]" /> : <ChevronDown className="w-4 h-4 text-[#9CA3AF]" />}
          </button>

          {showDebugDrawer && (
            <div className="p-3 sm:p-4 bg-[#111827] text-[#E5E7EB] font-mono text-[10px] sm:text-[11px] h-[180px] overflow-y-auto flex flex-col gap-1">
              {debugLogs.length === 0 ? (
                <span className="text-[#6B7280]">No telemetry events logged.</span>
              ) : (
                debugLogs.map((log) => (
                  <div key={log.id} className="flex items-start gap-1.5">
                    <span className="text-[#6B7280] font-mono">{log.timestamp}</span>
                    <span
                      className={`font-bold ${log.type === "error"
                        ? "text-[#EF4444]"
                        : log.type === "in"
                          ? "text-[#34D399]"
                          : log.type === "out"
                            ? "text-[#60A5FA]"
                            : "text-[#9CA3AF]"
                        }`}
                    >
                      [{log.type.toUpperCase()}]
                    </span>
                    <span className="text-[#F3F4F6] break-all">{log.message}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

      </main>

      {/* Footer */}
      <footer className="border-t border-[#E5E7EB] py-3 px-4 text-center font-mono text-[10px] sm:text-[11px] text-[#6B7280] bg-white mt-auto">
        YAPAI Voice Engine • Powered by Server Actions &amp; Gemini Live
      </footer>

      {/* API Key Modal */}
      {showApiKeyModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E5E7EB] max-w-md w-full rounded-xl p-5 sm:p-6 shadow-xl flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-[#FFF7ED] text-[#C2410C] border border-[#FFEDD5]">
                <Key className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#111827] font-mono">YAPAI Access Key</h3>
                <p className="text-xs text-[#6B7280]">Enter your Gemini API Key or Master Keyword</p>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-mono text-[#374151] font-semibold">
                API Key or Master Passcode:
              </label>
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => {
                  setApiKeyInput(e.target.value);
                  setKeyErrorMsg("");
                }}
                placeholder="AIzaSy... or yapai2026"
                className="w-full bg-[#F9FAFB] text-[#111827] text-xs font-mono p-2.5 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#E05A47]"
              />
              {keyErrorMsg && <p className="text-[11px] font-mono text-[#EF4444] mt-0.5">{keyErrorMsg}</p>}
            </div>

            <div className="bg-[#F9FAFB] border border-[#E5E7EB] p-3 rounded-lg flex flex-col gap-1 text-[11px] text-[#4B5563] font-mono leading-relaxed">
              <div className="flex items-center gap-1.5 font-bold text-[#111827]">
                <Lock className="w-3.5 h-3.5 text-[#E05A47]" /> Key Resolution Rules:
              </div>
              <p>• <strong>Other Users:</strong> Enter your own Gemini API Key (starts with <code>AIzaSy...</code>). Stored locally in your browser.</p>
              <p>• <strong>Owner:</strong> Enter your secret Master Passcode (<code>yapai2026</code>) to automatically unlock server ENV key.</p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setShowApiKeyModal(false)}
                className="px-4 py-2 rounded-md text-xs font-mono text-[#6B7280] hover:text-[#111827] transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveApiKey}
                className="tactile-btn px-5 py-2 rounded-md text-xs font-mono font-semibold text-white bg-[#E05A47] hover:bg-[#C94A38] shadow-sm cursor-pointer"
              >
                Save &amp; Unlock
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
