import os
import base64
import numpy as np
import cv2
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import google.generativeai as genai

app = FastAPI(title="MangaVerse Inpaint & Translate API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)


class TextBlock(BaseModel):
    x: int
    y: int
    w: int
    h: int
    text: str = ""


class InpaintRequest(BaseModel):
    image_b64: str
    text_blocks: List[TextBlock]


class TranslatedBlock(BaseModel):
    x: int
    y: int
    w: int
    h: int
    original: str
    translated: str


class InpaintResponse(BaseModel):
    canvas_b64: str
    translated_blocks: List[TranslatedBlock]


def decode_image(image_b64: str) -> np.ndarray:
    try:
        if "," in image_b64:
            image_b64 = image_b64.split(",", 1)[1]
        raw = base64.b64decode(image_b64)
        arr = np.frombuffer(raw, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("cv2.imdecode returned None — invalid image data.")
        return img
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Image decode error: {e}")


def build_mask(img_shape: tuple, blocks: List[TextBlock]) -> np.ndarray:
    h, w = img_shape[:2]
    mask = np.zeros((h, w), dtype=np.uint8)

    dilation_px = max(1, int(1.5))

    for blk in blocks:
        x1 = max(0, blk.x + dilation_px)
        y1 = max(0, blk.y + dilation_px)
        x2 = min(w, blk.x + blk.w - dilation_px)
        y2 = min(h, blk.y + blk.h - dilation_px)
        if x2 > x1 and y2 > y1:
            mask[y1:y2, x1:x2] = 255

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    mask = cv2.dilate(mask, kernel, iterations=1)

    return mask


def run_telea_inpaint(src: np.ndarray, mask: np.ndarray) -> np.ndarray:
    result = cv2.inpaint(src, mask, inpaintRadius=3, flags=cv2.INPAINT_TELEA)
    return result


def encode_image(img: np.ndarray) -> str:
    success, buf = cv2.imencode(".png", img)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to encode output image.")
    b64 = base64.b64encode(buf.tobytes()).decode("utf-8")
    return f"data:image/png;base64,{b64}"


def translate_blocks_gemini(blocks: List[TextBlock]) -> List[TranslatedBlock]:
    if not GEMINI_API_KEY:
        return [
            TranslatedBlock(
                x=b.x, y=b.y, w=b.w, h=b.h,
                original=b.text,
                translated="[GEMINI_API_KEY not set]"
            )
            for b in blocks
        ]

    model = genai.GenerativeModel("gemini-1.5-flash")
    results: List[TranslatedBlock] = []

    for blk in blocks:
        if not blk.text.strip():
            results.append(TranslatedBlock(
                x=blk.x, y=blk.y, w=blk.w, h=blk.h,
                original=blk.text, translated=""
            ))
            continue

        prompt = (
            "You are a professional manga translation engine. "
            "Translate the following manga dialogue text to Arabic. "
            "Preserve tone, speech patterns, and emotional nuance. "
            "Return ONLY the translated text, nothing else.\n\n"
            f"Source text:\n{blk.text}"
        )

        try:
            response = model.generate_content(prompt)
            translated = response.text.strip()
        except Exception as e:
            translated = f"[Translation error: {e}]"

        results.append(TranslatedBlock(
            x=blk.x, y=blk.y, w=blk.w, h=blk.h,
            original=blk.text,
            translated=translated
        ))

    return results


@app.get("/")
def health():
    return {"status": "ok", "engine": "OpenCV Telea", "gemini": bool(GEMINI_API_KEY)}


@app.post("/api/inpaint_and_translate", response_model=InpaintResponse)
def inpaint_and_translate(req: InpaintRequest):
    src = decode_image(req.image_b64)

    mask = build_mask(src.shape, req.text_blocks)

    inpainted = run_telea_inpaint(src, mask)

    translated_blocks = translate_blocks_gemini(req.text_blocks)

    canvas_b64 = encode_image(inpainted)

    return InpaintResponse(canvas_b64=canvas_b64, translated_blocks=translated_blocks)

#hamza