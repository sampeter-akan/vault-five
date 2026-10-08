import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const src = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')
const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
test('frontend authenticates anonymously and invokes server function', () => {
  assert.match(src, /signInAnonymously\(/)
  assert.match(src, /functions\.invoke\('game'/)
})
test('joining players persist active room for recovery', () => {
  assert.match(src, /localStorage\.setItem\(activeRoomStorage, data\.roomCode\)/)
})
test('schema declares row-level security', () => {
  assert.match(schema, /alter table public.rooms enable row level security/)
  assert.match(schema, /alter table public.players enable row level security/)
})
