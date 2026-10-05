import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const VAULT_KEY = Deno.env.get('VAULT_KEY')!
const broadcastState = async (room: string) => {
  const { data: g } = await supabase.from('games').select('*').eq('room_code', room).single()
  const { data: players } = await supabase.from('players').select('id,display_name,score,connected,is_host,submitted').eq('room_code', room).order('created_at')
  const channel = supabase.channel(`room:${room}`)
  await channel.subscribe()
  await channel.send({ type: 'broadcast', event: 'state', payload: { roomCode: room, status:g.status, roundEndsAt:g.round_ends_at ? Date.parse(g.round_ends_at) : null, winnerId:g.winner_id, vaultUnlocked:g.vault_unlocked, players:(players||[]).map(p=>({id:p.id,name:p.display_name,score:p.score,connected:p.connected,isHost:p.is_host,submitted:p.submitted})) } })
  await supabase.removeChannel(channel)
}
const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const code = () => Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join('')

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { action, roomCode, playerId, name, answer } = await req.json()
    if (action === 'create') {
      const hostId = crypto.randomUUID(); let room = code()
      for (let i=0;i<8;i++) { const {data} = await supabase.from('games').select('room_code').eq('room_code', room).maybeSingle(); if (!data) break; room = code() }
      const {error:gErr} = await supabase.from('games').insert({room_code:room,host_id:hostId})
      if (gErr) throw gErr
      const {error:pErr} = await supabase.from('players').insert({id:hostId,room_code:room,display_name:name, is_host:true})
      if (pErr) throw pErr
      await broadcastState(room); return json({ roomCode: room, playerId: hostId })
    }
    if (action === 'join') {
      const room = roomCode.toUpperCase(); const {data:g} = await supabase.from('games').select('*').eq('room_code',room).maybeSingle(); if (!g) return json({error:'Room not found.'},404)
      const {count} = await supabase.from('players').select('*',{count:'exact',head:true}).eq('room_code',room); if ((count??0)>=8) return json({error:'Room is full.'},409)
      const id=crypto.randomUUID(); const {error} = await supabase.from('players').insert({id,room_code:room,display_name:name}); if(error) throw error
      await broadcastState(room); return json({roomCode:room,playerId:id})
    }
    if (action === 'state') {
      const { data:g } = await supabase.from('games').select('*').eq('room_code',roomCode.toUpperCase()).maybeSingle(); if (!g) return json({error:'Room not found.'},404)
      const { data:players } = await supabase.from('players').select('id,display_name,score,connected,is_host,submitted').eq('room_code',roomCode.toUpperCase()).order('created_at')
      return json({game:{roomCode:g.room_code,status:g.status,roundEndsAt:g.round_ends_at?Date.parse(g.round_ends_at):null,winnerId:g.winner_id,vaultUnlocked:g.vault_unlocked,players:(players||[]).map(p=>({id:p.id,name:p.display_name,score:p.score,connected:p.connected,isHost:p.is_host,submitted:p.submitted}))}})
    }
    if (action === 'start') {
      const {data:g} = await supabase.from('games').select('*').eq('room_code',roomCode).single(); if (!g || g.host_id!==playerId) return json({error:'Only the host can start.'},403)
      const {count} = await supabase.from('players').select('*',{count:'exact',head:true}).eq('room_code',roomCode); if ((count??0)<2) return json({error:'At least two players are required.'},409)
      await supabase.from('games').update({status:'round1',round_ends_at:new Date(Date.now()+45000).toISOString()}).eq('room_code',roomCode); await broadcastState(roomCode); return json({ok:true})
    }
    if (action === 'round') {
      const {data:g} = await supabase.from('games').select('*').eq('room_code',roomCode).single(); if (!g) return json({error:'Room not found.'},404)
      const next = g.status==='round1' ? 'round2' : 'final'; const seconds=next==='round2'?35:60
      const {data:p} = await supabase.from('players').select('score').eq('id',playerId).single(); const bonus=answer==='correct'?(next==='round2'?100:200):0
      await supabase.from('players').update({score:(p?.score??0)+bonus,submitted:true}).eq('id',playerId)
      await supabase.from('games').update({status:next,round_ends_at:new Date(Date.now()+seconds*1000).toISOString()}).eq('room_code',roomCode); await broadcastState(roomCode); return json({ok:true})
    }
    if (action === 'vault') {
      const correct = answer === VAULT_KEY; const {data:p}=await supabase.from('players').select('score').eq('id',playerId).single();
      await supabase.from('players').update({score:(p?.score??0)+(correct?1100:0),submitted:true}).eq('id',playerId)
      if (correct) await supabase.from('games').update({status:'result',round_ends_at:null,winner_id:playerId,vault_unlocked:true}).eq('room_code',roomCode)
      else await supabase.from('games').update({status:'result',round_ends_at:null}).eq('room_code',roomCode)
      await broadcastState(roomCode); return json({correct})
    }
    throw new Error('Unknown action')
  } catch (e) { return json({error: e instanceof Error ? e.message : 'Server error'}, 500) }
})
