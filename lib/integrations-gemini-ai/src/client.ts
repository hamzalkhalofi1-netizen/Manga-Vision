import { GoogleGenAI } from "@google/genai";

export const ai = new GoogleGenAI({
  apiKey: "AIzaSyAYhL313Dhf5H_uQ-OQwwNwIXnKjYjXkYM",
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com",
  },
});
