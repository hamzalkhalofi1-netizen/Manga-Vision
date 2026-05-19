import { GoogleGenAI } from "@google/genai";

export const ai = new GoogleGenAI({
  apiKey: "AIzaSyAYhL313Dhf5H_uQ-OQwwNwIXnKjYjXkYM",
  httpOptions: {
    apiVersion: "v1beta",
    baseUrl: "https://generativelanguage.googleapis.com",
  },
});
