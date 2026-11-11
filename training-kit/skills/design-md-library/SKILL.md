---
name: design-md-library
description: Library of 74 ready-made DESIGN.md design-system analyses of well-known brand sites (Stripe, Linear, Vercel, Apple, Notion, Airbnb, Shopify, Revolut, Tesla, BMW and others) from VoltAgent/awesome-design-md. Use when the user asks for a UI "in the style of" or "that looks like" one of these brands, wants a design reference or inspiration for a new page, or asks to drop a DESIGN.md into a project.
---

# DESIGN.md library

Source: https://github.com/VoltAgent/awesome-design-md (MIT, see `LICENSE`). Snapshot copied on 2026-10-05.

Each brand has one file at `design-md/<brand>/DESIGN.md` next to this skill. A file holds YAML front matter with tokens (colors, typography, spacing, radii) followed by prose on layout, components and the overall feel.

## Available brands

airbnb, airtable, apple, binance, bmw, bmw-m, bugatti, cal, claude, clay, clickhouse, cohere, coinbase, composio, cursor, dell-1996, elevenlabs, expo, ferrari, figma, framer, hashicorp, hp, ibm, intercom, kraken, lamborghini, linear.app, lovable, mastercard, meta, minimax, mintlify, miro, mistral.ai, mongodb, nike, nintendo-2001, notion, nvidia, ollama, opencode.ai, pinterest, playstation, posthog, raycast, renault, replicate, resend, revolut, runwayml, sanity, sentry, shopify, slack, spacex, spotify, starbucks, stripe, supabase, superhuman, tesla, theverge, together.ai, uber, vercel, vodafone, voltagent, warp, webflow, wired, wise, x.ai, zapier

## How to use

1. Pick the brand the user named. If they only described a mood, suggest two or three fitting brands and let them choose.
2. Read that brand's `DESIGN.md` in full before writing any UI code.
3. Either build directly from it, or, if the user wants it kept with the project, copy it to the project root as `DESIGN.md` and reference it from there.
4. Treat the file as a reference for tokens and patterns, not as a licence to copy a brand's logo, name or proprietary fonts. Substitute an available font when the original is proprietary.

An existing project design system takes priority. When working inside a project that already has its own look, use these files only for ideas the user asked for, not to restyle the project.
