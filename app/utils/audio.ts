// Audio utility functions for Gemini Multimodal Live API (PCM 16-bit 16kHz input / 24kHz output)

/**
 * Converts Float32Array PCM audio from Web Audio API (mic) to Int16Array PCM.
 */
export function float32ToInt16PCM(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16Array;
}

/**
 * Converts ArrayBuffer / Int16Array to Base64 string for WebSocket transmission.
 */
export function arrayBufferToBase64(buffer: ArrayBufferLike): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return typeof btoa !== "undefined" ? btoa(binary) : Buffer.from(binary, "binary").toString("base64");
}

/**
 * Decodes base64 PCM 16-bit signed Little-Endian audio string from Gemini server to Float32Array.
 */
export function base64ToFloat32PCM(base64: string): Float32Array {
  const binaryString = typeof atob !== "undefined" ? atob(base64) : Buffer.from(base64, "base64").toString("binary");
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  const dataView = new DataView(bytes.buffer);
  const numSamples = Math.floor(len / 2);
  const float32Array = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const int16 = dataView.getInt16(i * 2, true); // true = Little Endian
    float32Array[i] = int16 / 32768.0;
  }
  return float32Array;
}

/**
 * Audio Player queue with exact playback state, AnalyserNode, & MediaStream Destination for STT.
 */
export class RealtimeAudioPlayer {
  private audioCtx: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private mediaStreamDest: MediaStreamAudioDestinationNode | null = null;
  private freqData: Uint8Array | null = null;
  private nextStartTime: number = 0;
  private activeSourcesCount: number = 0;
  private sampleRate: number;

  public onStateChange?: (isPlaying: boolean) => void;

  constructor(sampleRate: number = 24000) {
    this.sampleRate = sampleRate;
  }

  public init() {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtxClass({ sampleRate: this.sampleRate });
      
      this.analyserNode = this.audioCtx.createAnalyser();
      this.analyserNode.fftSize = 64;
      this.analyserNode.smoothingTimeConstant = 0.75;
      this.analyserNode.connect(this.audioCtx.destination);

      try {
        this.mediaStreamDest = this.audioCtx.createMediaStreamDestination();
        this.analyserNode.connect(this.mediaStreamDest);
      } catch (e) {
        console.warn("MediaStreamDestination not supported:", e);
      }

      this.freqData = new Uint8Array(this.analyserNode.frequencyBinCount);
    }
    if (this.audioCtx.state === "suspended") {
      this.audioCtx.resume();
    }
    if (this.nextStartTime === 0) {
      this.nextStartTime = this.audioCtx.currentTime;
    }
  }

  public getSpectrumData(): Uint8Array {
    if (this.analyserNode && this.freqData) {
      this.analyserNode.getByteFrequencyData(this.freqData);
      return this.freqData;
    }
    return new Uint8Array(0);
  }

  public getMediaStream(): MediaStream | null {
    return this.mediaStreamDest ? this.mediaStreamDest.stream : null;
  }

  public playChunk(base64PCM: string) {
    if (!base64PCM) return;
    this.init();
    if (!this.audioCtx || !this.analyserNode) return;

    const float32PCM = base64ToFloat32PCM(base64PCM);
    if (float32PCM.length === 0) return;

    const buffer = this.audioCtx.createBuffer(1, float32PCM.length, this.sampleRate);
    buffer.getChannelData(0).set(float32PCM);

    const source = this.audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyserNode);

    const currentTime = this.audioCtx.currentTime;
    if (this.nextStartTime < currentTime) {
      this.nextStartTime = currentTime;
    }

    if (this.activeSourcesCount === 0) {
      this.onStateChange?.(true);
    }
    this.activeSourcesCount++;

    source.onended = () => {
      this.activeSourcesCount--;
      if (this.activeSourcesCount <= 0) {
        this.activeSourcesCount = 0;
        this.onStateChange?.(false);
      }
    };

    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;
  }

  public stop() {
    if (this.audioCtx && this.audioCtx.state !== "closed") {
      this.audioCtx.close();
      this.audioCtx = null;
      this.analyserNode = null;
      this.mediaStreamDest = null;
      this.freqData = null;
    }
    this.nextStartTime = 0;
    this.activeSourcesCount = 0;
    this.onStateChange?.(false);
  }
}
