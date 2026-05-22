---
title: MangaVerse Inpaint & Translate
emoji: 🖼️
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
secrets:
  - name: GEMINI_API_KEY
    description: "Your Google Gemini API key. Get one free at https://aistudio.google.com/app/apikey"
    required: true
---

# MangaVerse — Native OpenCV Inpainting + Gemini Arabic Translation API

A production-grade, self-hosted backend for the MangaVerse React Native app.  
Runs entirely inside a Docker container on Hugging Face Spaces.

## What it does

| Step | Engine | Description |
|------|--------|-------------|
| 1 | **OpenCV Telea** | Receives a Base64 manga page image and bounding boxes of speech bubbles, builds a binary stroke mask with 1.5 px dilation inset, and erases the original text via `cv2.INPAINT_TELEA` |
| 2 | **Gemini 1.5 Flash** | Translates each extracted dialogue string to Arabic with tone and nuance preserved |
| 3 | **FastAPI** | Returns the clean inpainted canvas (PNG Base64) and the full translated block array to the mobile app |

---

## Quick Deploy

1. Click **"Duplicate Space"** on the Hugging Face page  
2. When prompted, enter your **GEMINI_API_KEY** (Settings → Variables and Secrets)  
3. The Space builds automatically — wait ~2 minutes for the Docker image  
4. Copy the Space URL and paste it as `API_BASE_URL` in your React Native app

---

## API Reference

### `GET /`
Health check.

```json
{ "status": "ok", "engine": "OpenCV Telea", "gemini": true }
```

### `POST /api/inpaint_and_translate`

**Request body**
```json
{
  "image_b64": "data:image/png;base64,<...>",
  "text_blocks": [
    { "x": 10, "y": 20, "w": 120, "h": 50, "text": "Hello world" }
  ]
}
```

**Response**
```json
{
  "canvas_b64": "data:image/png;base64,<clean inpainted image>",
  "translated_blocks": [
    {
      "x": 10, "y": 20, "w": 120, "h": 50,
      "original": "Hello world",
      "translated": "مرحبا بالعالم"
    }
  ]
}
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | ✅ Yes | Google Gemini API key for translation |

Set it in **Space Settings → Variables and Secrets** — never commit it to your repository.

---

## Local Development

```bash
# Build
docker build -t mangaverse-api .

# Run (replace with your key)
docker run -p 7860:7860 -e GEMINI_API_KEY=your_key_here mangaverse-api
```

Then open `http://localhost:7860` to confirm the health endpoint.

---

## Stack

- **FastAPI** 0.111 — async HTTP server  
- **OpenCV Headless** 4.9 — native Telea inpainting (no display server needed)  
- **google-generativeai** 0.7 — Gemini SDK  
- **Python** 3.11-slim + Ubuntu graphics libs (`libgl1-mesa-glx`, `libglib2.0-0`)
