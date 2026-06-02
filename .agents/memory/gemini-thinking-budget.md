---
name: Gemini thinkingBudget OCR fix
description: gemini-2.5-flash OCR returns 0 regions unless thinkingBudget:0 is set; free tier = 20 req/day
---

# Gemini 2.5 Flash OCR — thinkingBudget:0

## The Rule
When calling `gemini-2.5-flash` for manga page OCR/JSON extraction, always include `thinkingConfig: { thinkingBudget: 0 }` in the generation config. Without it, the model spends its thinking budget on chain-of-thought reasoning and frequently returns 0 regions or stalls.

## Why
`gemini-2.5-flash` defaults to extended thinking mode. For structured JSON extraction (manga OCR), thinking adds latency (~36s) with no accuracy benefit and often causes the model to return empty arrays. With `thinkingBudget: 0`, thinking is disabled and the model returns direct JSON in 12-62 seconds.

## Measured Impact
- Before: ~80% of tested pages returned 0 regions after 33-37 seconds
- After: All pages that get through return meaningful regions (p01: 30, p03: 15, p13: 11, p14: 9)

## Free Tier Rate Limit
Gemini API free tier: **20 requests/day** for `gemini-2.5-flash`. This is easy to exhaust during validation. Consider:
- Caching OCR results (the regions JSON) keyed by image hash
- Using pre-saved OCR regions for CV-only tests (skip Gemini)
- Model: `gemini-2.0-flash` has higher free tier limits if 2.5-flash runs out

## Config Location
`artifacts/mobile/services/geminiTranslate.ts` — `OCR_GEN_CONFIG` const
