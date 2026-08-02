"use client";

import React, { useState, useEffect, useRef } from "react";
import { GoogleGenAI, Modality } from "@google/genai";
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
} from "lucide-react";
import { RealtimeAudioPlayer, float32ToInt16PCM, arrayBufferToBase64 } from "./utils/audio";

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
  { id: "gemini-3.1-flash-live-preview", name: "gemini-3.1-flash-live" },
  { id: "gemini-2.5-flash-native-audio-preview-12-2025", name: "gemini-2.5-flash-audio" },
];

export default function HomePage() {
  const [apiKeyInput, setApiKeyInput] = useState<string>("");
  const [showApiKeyModal, setShowApiKeyModal] = useState<boolean>(false);
  const [hasCustomKey, setHasCustomKey] = useState<boolean>(false);
  const [showMobileSettings, setShowMobileSettings] = useState<boolean>(false);

  const [selectedVoice, setSelectedVoice] = useState<string>("Puck");
  const [selectedModel, setSelectedModel] = useState<string>("gemini-3.1-flash-live-preview");
  const [systemInstruction, setSystemInstruction] = useState<string>(
    "You are YAPAI, a concise, highly intelligent real-time voice assistant. Respond naturally."
  );

  const [connectionStatus, setConnectionStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isYapaiSpeaking, setIsYapaiSpeaking] = useState<boolean>(false);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [latencyMs, setLatencyMs] = useState<number>(24);

  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
  const [showDebugDrawer, setShowDebugDrawer] = useState<boolean>(false);

  // Real-time audio spectrum data array (16 frequency bars)
  const [spectrumBars, setSpectrumBars] = useState<number[]>(new Array(16).fill(8));

  // Audio & Session Refs
  const sessionRef = useRef<any>(null);
  const audioPlayerRef = useRef<RealtimeAudioPlayer | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);

  // Refs for real-time VAD auto-interruption inside Web Audio callbacks
  const isYapaiSpeakingRef = useRef<boolean>(false);
  const isMutedRef = useRef<boolean>(false);

  useEffect(() => {
    isYapaiSpeakingRef.current = isYapaiSpeaking;
  }, [isYapaiSpeaking]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // Speaker state calculation
  const isUserSpeaking = connectionStatus === "live" && !isMuted && !isYapaiSpeaking && audioLevel > 14;

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

  // Init audio player with onStateChange listener
  useEffect(() => {
    const savedKey = localStorage.getItem("YAPAI_API_KEY");
    if (savedKey) {
      setApiKeyInput(savedKey);
      setHasCustomKey(true);
    }

    const player = new RealtimeAudioPlayer(24000);
    player.onStateChange = (playing: boolean) => {
      setIsYapaiSpeaking(playing);
    };
    audioPlayerRef.current = player;

    addDebugLog("info", "YAPAI Engine ready for Voice Session.");

    return () => {
      cleanupAudio();
    };
  }, []);

  const addDebugLog = (type: "info" | "in" | "out" | "error", message: string) => {
    const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 });
    setDebugLogs((prev) => [
      { id: Math.random().toString(), timestamp, type, message },
      ...prev.slice(0, 49),
    ]);
  };

  const getEffectiveApiKey = () => {
    return apiKeyInput.trim() || process.env.NEXT_PUBLIC_GEMINI_API_KEY || "";
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

  // Start YAPAI Multimodal Live Session
  const handleStartLiveSession = async () => {
    const apiKey = getEffectiveApiKey();
    if (!apiKey) {
      setShowApiKeyModal(true);
      addDebugLog("error", "API Key missing. Enter API Key to proceed.");
      return;
    }

    setConnectionStatus("connecting");
    addDebugLog("info", `Initiating YAPAI Live WebSocket connection (${selectedModel})...`);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx({ sampleRate: 16000 });
      audioContextRef.current = audioCtx;

      const sourceNode = audioCtx.createMediaStreamSource(stream);

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
      workletNode.connect(audioCtx.destination);

      const ai = new GoogleGenAI({ apiKey });

      const startTime = Date.now();
      const session = await ai.live.connect({
        model: selectedModel,
        config: {
          responseModalities: [(Modality?.AUDIO || "AUDIO") as any],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: selectedVoice,
              },
            },
          },
          systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
        },
        callbacks: {
          onopen: () => {
            const roundtrip = Date.now() - startTime;
            setLatencyMs(Math.max(18, Math.min(80, roundtrip)));
            setConnectionStatus("live");
            addDebugLog("info", `YAPAI Engine Connected (${roundtrip}ms latency)`);
          },
          onmessage: (serverMessage: any) => {
            handleServerMessage(serverMessage);
          },
          onerror: (err: any) => {
            addDebugLog("error", `YAPAI WS Error: ${err?.message || "Connection error"}`);
            setConnectionStatus("error");
          },
          onclose: (e: any) => {
            addDebugLog("info", `YAPAI Session Closed (Code ${e?.code || 1000})`);
            setConnectionStatus("idle");
            cleanupAudio();
          },
        },
      });

      sessionRef.current = session;

      workletNode.port.onmessage = (e: MessageEvent) => {
        if (isMutedRef.current) return;
        const inputData: Float32Array = e.data;

        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);
        const level = Math.min(100, Math.round(rms * 450));
        setAudioLevel(level);

        if (isYapaiSpeakingRef.current && level > 24) {
          triggerAutoInterruption("User spoken audio detected");
        }

        const int16PCM = float32ToInt16PCM(inputData);
        const base64PCM = arrayBufferToBase64(int16PCM.buffer);

        if (sessionRef.current) {
          try {
            sessionRef.current.sendRealtimeInput({
              audio: {
                mimeType: "audio/pcm;rate=16000",
                data: base64PCM,
              },
            });
          } catch (sendErr) {
            console.warn("Failed sending realtime input:", sendErr);
          }
        }
      };
    } catch (err: any) {
      addDebugLog("error", `Setup failure: ${err?.message}`);
      setConnectionStatus("error");
      cleanupAudio();
    }
  };

  const handleServerMessage = (serverMessage: any) => {
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
    if (sessionRef.current) {
      try {
        sessionRef.current.close();
      } catch (err) {
        console.warn("Error closing session:", err);
      }
      sessionRef.current = null;
    }
    cleanupAudio();
    setConnectionStatus("idle");
    setIsYapaiSpeaking(false);
    setAudioLevel(0);
    addDebugLog("info", "Session ended by user.");
  };

  const cleanupAudio = () => {
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

  const handleSaveApiKey = () => {
    if (apiKeyInput.trim()) {
      localStorage.setItem("YAPAI_API_KEY", apiKeyInput.trim());
      setHasCustomKey(true);
    } else {
      localStorage.removeItem("YAPAI_API_KEY");
      setHasCustomKey(false);
    }
    setShowApiKeyModal(false);
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
                className={`w-2 h-2 rounded-full transition-all duration-300 ${
                  connectionStatus === "live"
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
            {/* Model Selector */}
            <div className="flex items-center bg-[#F3F4F6] border border-[#E5E7EB] rounded-md px-2.5 py-1.5 text-xs font-mono">
              <Cpu className="w-3.5 h-3.5 text-[#6B7280] mr-1.5" />
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
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
                onChange={(e) => setSelectedVoice(e.target.value)}
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
              className="tactile-btn flex items-center gap-1.5 bg-white border border-[#E5E7EB] hover:border-[#D1D5DB] px-3 py-1.5 rounded-md text-xs font-mono font-medium text-[#374151] cursor-pointer"
            >
              <Key className="w-3.5 h-3.5 text-[#6B7280]" />
              <span>{hasCustomKey ? "Key Set" : "API Key"}</span>
            </button>
          </div>

          {/* Mobile Settings Toggle Button */}
          <div className="flex md:hidden items-center gap-2">
            <button
              onClick={() => setShowApiKeyModal(true)}
              className="tactile-btn flex items-center justify-center p-2 rounded-md border border-[#E5E7EB] bg-white text-[#374151]"
              title="API Key"
            >
              <Key className="w-4 h-4 text-[#6B7280]" />
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
              <label className="text-[10px] font-mono text-[#6B7280] font-bold">MODEL:</label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
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
                onChange={(e) => setSelectedVoice(e.target.value)}
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

      {/* 2. Main Workstation Area (Fully Responsive Layout) */}
      <main className="flex-1 w-full max-w-4xl mx-auto p-3 sm:p-6 lg:p-8 flex flex-col gap-4 sm:gap-6 justify-center">
        
        {/* Workstation Card */}
        <div className="swiss-panel rounded-xl p-4 sm:p-8 lg:p-10 flex flex-col justify-between min-h-[380px] sm:min-h-[460px] relative bg-white shadow-xs">
          
          {/* Status Bar */}
          <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-3 font-mono text-[11px] sm:text-xs">
            <span className="text-[#6B7280] uppercase tracking-wider flex items-center gap-1.5 font-bold">
              <Activity className="w-3.5 h-3.5 text-[#E05A47]" /> YAPAI WORKSTATION
            </span>
            <span className="text-[#9CA3AF] text-[10px] sm:text-xs">VAD INTERRUPT AUTO</span>
          </div>

          {/* Center Visualizer & State Title */}
          <div className="my-6 sm:my-10 flex flex-col items-center justify-center text-center">
            
            {/* Dynamic Soundwave Bar Chart (16 Bars - Mobile Fit width & gap) */}
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
                ? "Speak naturally into microphone. Interrupt Yapai by speaking at any time."
                : "Press Start Session to begin real-time voice stream."}
            </p>
          </div>

          {/* Mobile-First Controls Panel at Bottom */}
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
                    className={`tactile-btn flex items-center justify-center gap-1.5 px-3 sm:px-5 py-2.5 rounded-lg font-mono text-xs border font-semibold cursor-pointer ${
                      isMuted
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

                  {/* End Session Button (Full width on mobile grid) */}
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

            {/* Audio Telemetry Specs */}
            <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-mono text-[#6B7280]">
              <span>Audio:</span>
              <span className="bg-[#F3F4F6] text-[#111827] px-2 py-0.5 rounded border border-[#E5E7EB] font-bold text-[10px]">
                16kHz mic / 24kHz PCM out
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
          </div>
          <textarea
            value={systemInstruction}
            onChange={(e) => setSystemInstruction(e.target.value)}
            disabled={connectionStatus === "live"}
            rows={2}
            className="w-full bg-[#F9FAFB] text-[#111827] text-xs p-2.5 sm:p-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#E05A47] font-sans resize-none disabled:opacity-60 leading-relaxed"
          />
        </div>

        {/* Telemetry Log Drawer */}
        <div className="swiss-panel rounded-xl flex flex-col bg-white shadow-xs overflow-hidden">
          <button
            onClick={() => setShowDebugDrawer(!showDebugDrawer)}
            className="px-4 py-2.5 border-b border-[#E5E7EB] bg-[#F9FAFB] hover:bg-[#F3F4F6] flex items-center justify-between font-mono text-xs text-[#374151] transition cursor-pointer"
          >
            <span className="flex items-center gap-1.5 font-bold text-[11px] sm:text-xs">
              <Terminal className="w-3.5 h-3.5 text-[#6B7280]" /> TELEMETRY &amp; WEBSOCKET LOGS
            </span>
            {showDebugDrawer ? <ChevronUp className="w-4 h-4 text-[#6B7280]" /> : <ChevronDown className="w-4 h-4 text-[#6B7280]" />}
          </button>

          {showDebugDrawer && (
            <div className="p-3 sm:p-4 bg-[#111827] text-[#E5E7EB] font-mono text-[10px] sm:text-[11px] h-[150px] overflow-y-auto flex flex-col gap-1">
              {debugLogs.length === 0 ? (
                <span className="text-[#6B7280]">No telemetry events logged.</span>
              ) : (
                debugLogs.map((log) => (
                  <div key={log.id} className="flex items-start gap-1.5">
                    <span className="text-[#6B7280] font-mono">{log.timestamp}</span>
                    <span
                      className={`font-bold ${
                        log.type === "error"
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
        YAPAI Voice Engine • Bidirectional Real-Time PCM Stream
      </footer>

      {/* API Key Modal */}
      {showApiKeyModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E5E7EB] max-w-md w-full rounded-xl p-5 sm:p-6 shadow-xl flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-[#F3F4F6] text-[#111827] border border-[#E5E7EB]">
                <Key className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#111827] font-mono">YAPAI API Key</h3>
                <p className="text-xs text-[#6B7280]">Required for Multimodal WebSocket Live API</p>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-mono text-[#374151] font-semibold">API Key:</label>
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full bg-[#F9FAFB] text-[#111827] text-xs font-mono p-2.5 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#E05A47]"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
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
                Save Key
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
