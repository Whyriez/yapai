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
        error: "GEMINI_API_KEY is missing. Please enter your API key in the top settings header or set GEMINI_API_KEY in your .env.local file.",
      };
    }

    const client = new GoogleGenAI({ apiKey: keyToUse });

    let outputText = "";
    let methodUsed = "";

    try {
      // Attempt using client.interactions.create as requested
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
      
      // Fallback to client.models.generateContent
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
