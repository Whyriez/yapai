"use server";

import { GoogleGenAI } from "@google/genai";

export interface InteractionParams {
  model?: string;
  input: string;
  apiKey?: string;
}

export interface InteractionResult {
  success: boolean;
  outputText?: string;
  methodUsed?: string;
  error?: string;
}

export interface ResolveKeyResult {
  success: boolean;
  apiKey?: string;
  isMaster?: boolean;
  error?: string;
}

/**
 * Resolves user input key or master keyword to a valid Gemini API Key on server.
 */
export async function resolveApiKeyAction(userInput: string): Promise<ResolveKeyResult> {
  const trimmed = userInput.trim();
  const masterKeyword = (process.env.YAPAI_MASTER_KEYWORD || "yapai2026").trim().toLowerCase();
  const envApiKey = process.env.GEMINI_API_KEY?.trim() || "";

  if (!trimmed) {
    return {
      success: false,
      error: "API Key or Passcode cannot be empty.",
    };
  }

  // Check if input matches secret master keyword (case-insensitive)
  if (trimmed.toLowerCase() === masterKeyword) {
    if (!envApiKey || envApiKey === "your_gemini_api_key_here") {
      return {
        success: false,
        error: "Master Passcode accepted, but GEMINI_API_KEY is missing in server .env.local.",
      };
    }
    return {
      success: true,
      apiKey: envApiKey,
      isMaster: true,
    };
  }

  // Otherwise, treat as user's own Gemini API Key
  if (trimmed.startsWith("AIzaSy") || trimmed.length >= 20) {
    return {
      success: true,
      apiKey: trimmed,
      isMaster: false,
    };
  }

  return {
    success: false,
    error: "Invalid Gemini API Key or Master Passcode. (Master passcode format or AIzaSy... API key required)",
  };
}

export async function runInteractionAction({
  model = "gemini-3.1-pro-preview",
  input,
  apiKey,
}: InteractionParams): Promise<InteractionResult> {
  try {
    const keyToUse = apiKey?.trim() || process.env.GEMINI_API_KEY?.trim();

    if (!keyToUse || keyToUse === "your_gemini_api_key_here") {
      return {
        success: false,
        error: "GEMINI_API_KEY is missing. Please enter your API key in settings or set GEMINI_API_KEY in .env.local file.",
      };
    }

    const client = new GoogleGenAI({ apiKey: keyToUse });

    let outputText = "";
    let methodUsed = "";

    try {
      const interaction = await (client as any).interactions.create({
        model: model || "gemini-3.1-pro-preview",
        input: input,
      });

      if (typeof interaction === "string") {
        outputText = interaction;
      } else if (interaction?.output_text) {
        outputText = interaction.output_text;
      } else if (interaction?.text) {
        outputText = interaction.text;
      } else {
        outputText = JSON.stringify(interaction, null, 2);
      }
      methodUsed = "client.interactions.create";
    } catch (interactionErr: any) {
      console.warn("Interactions API fallback triggered:", interactionErr?.message);
      
      const fallbackModel = model.includes("gemini-3") ? model : "gemini-2.5-flash";
      const response = await client.models.generateContent({
        model: fallbackModel,
        contents: input,
      });

      outputText = response.text || "No output text returned.";
      methodUsed = `client.models.generateContent (${fallbackModel})`;
    }

    return {
      success: true,
      outputText,
      methodUsed,
    };
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    return {
      success: false,
      error: error?.message || "Failed to execute Gemini API call.",
    };
  }
}
