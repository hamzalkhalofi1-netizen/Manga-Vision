import { GoogleGenAI } from "@google/genai";

const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com";
const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY ?? "placeholder";

export const ai = new GoogleGenAI({
  apiKey,
  httpOptions: {
    apiVersion: "v1beta",
    baseUrl,
  },
});

export function createUserGeminiClient(userApiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey: userApiKey });
}
