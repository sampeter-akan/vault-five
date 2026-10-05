# Vault Five

A premium, mobile-first live multiplayer party game inspired by the supplied REXX safe-box logic and host/join room flow.

## Core rule
The supplied program resolves the five-digit safe-box key to **68668**. In production this value is kept server-side and never shipped to the browser.

## Stack
- React 19 + TypeScript + Vite
- Supabase Realtime for synchronized room state
- Supabase Edge Function for server-authoritative mutations
- Vercel-compatible static frontend deployment

## Local development
1. `npm install`
2. Copy `.env.example` to `.env.local` and set Supabase URL + anon key.
3. `npm run dev`

The current frontend includes a local simulation mode when Supabase variables are absent, so the complete UI/flow can be reviewed before backend connection.

## Production security
Set `VAULT_KEY=68668` only as a Supabase Edge Function secret. Do not place it in `VITE_*` variables or frontend code.
