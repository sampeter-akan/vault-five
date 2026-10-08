import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ArrowRight, Check, Copy, Crown, LockKeyhole, LogIn, Plus, Radio, RotateCcw, ShieldCheck, Sparkles, Users, Wifi, X } from 'lucide-react'
import './styles.css'

type Screen = 'home' | 'create' | 'join' | 'lobby' | 'howto' | 'round1' | 'round2' | 'final' | 'result'
type Player = { id: string; name: string; score: number; connected: boolean; isHost?: boolean; submitted?: boolean }
type GameState = { roomCode: string; status: 'lobby'|'round1'|'round2'|'final'|'result'; roundEndsAt: number|null; players: Player[]; winnerId?: string; vaultUnlocked?: boolean; finalAnswers?: Record<string,string> }

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const supabase: SupabaseClient | null = SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null
const demoStorage = 'vault-five-demo'
const activeRoomStorage = 'vault-five-active-room'

async function ensureAnonymousSession() {
  if (!supabase) throw new Error('Realtime backend is not configured.')
  const { data: { session } } = await supabase.auth.getSession()
  if (session) return session
  const { data, error } = await supabase.auth.signInAnonymously()
  if (error || !data.session) throw error ?? new Error('Could not start an anonymous game session.')
  return data.session
}

const initialDemo: GameState = { roomCode: '7K4P', status: 'lobby', roundEndsAt: null, players: [] }

async function api(action: string, body: Record<string, unknown>) {
  if (!supabase) throw new Error('Realtime backend is not configured.')
  const session = await ensureAnonymousSession()
  const { data, error } = await supabase.functions.invoke('game', {
    body: { action, ...body },
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (error) {
    const response = (error as { context?: Response }).context
    if (response && typeof response.json === 'function') {
      const details = await response.json().catch(() => null)
      throw new Error(details?.error || error.message)
    }
    throw error
  }
  if (data?.error) throw new Error(data.error)
  return data
}

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [name, setName] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [playerId, setPlayerId] = useState(() => localStorage.getItem('vault-five-player') || crypto.randomUUID())
  const [game, setGame] = useState<GameState>(() => JSON.parse(localStorage.getItem(demoStorage) || JSON.stringify(initialDemo)))
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [demo, setDemo] = useState(!supabase)
  const [syncIssue, setSyncIssue] = useState(false)
  const [vaultFeedback, setVaultFeedback] = useState('')
  const [vaultBusy, setVaultBusy] = useState(false)

  useEffect(() => {
    if (!supabase) return
    const saved = localStorage.getItem(activeRoomStorage)
    if (!saved) return
    let cancelled = false
    void api('state', { roomCode: saved }).then((state) => {
      if (cancelled || !state?.roomCode) return
      setRoomCode(state.roomCode)
      setGame(state as GameState)
    }).catch(() => {
      if (!cancelled) localStorage.removeItem(activeRoomStorage)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    localStorage.setItem(demoStorage, JSON.stringify(game))
  }, [game])

  useEffect(() => {
    if (!supabase || !game.roomCode || demo || !localStorage.getItem(activeRoomStorage)) return
    let channel: ReturnType<typeof supabase.channel> | null = null
    let cancelled = false
    void (async () => {
      try {
        await ensureAnonymousSession()
        await supabase.realtime.setAuth()
        if (cancelled) return
        channel = supabase.channel(`room:${game.roomCode}:state`, { config: { private: true } })
          .on('broadcast', { event: 'state' }, ({ payload }) => setGame(payload as GameState))
        channel.subscribe()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Realtime connection failed.')
      }
    })()
    return () => { cancelled = true; if (channel) void supabase.removeChannel(channel) }
  }, [game.roomCode, demo])

  useEffect(() => {
    if (demo) return
    const next: Record<GameState['status'], Screen> = { lobby:'lobby', round1:'round1', round2:'round2', final:'final', result:'result' }
    if (localStorage.getItem(activeRoomStorage)) setScreen(next[game.status])
  }, [game.status, demo])

  useEffect(() => {
    if (!supabase || demo || !game.roomCode || !localStorage.getItem(activeRoomStorage)) return
    void api('state', { roomCode: game.roomCode }).then((data) => { if (data?.roomCode) setGame(data as GameState) }).catch(() => {})
  }, [game.roomCode, demo])

  useEffect(() => {
    if (!supabase || demo || !game.roomCode || !localStorage.getItem(activeRoomStorage) || game.status === 'result') return
    let cancelled = false
    let busy = false
    const refresh = async () => {
      if (busy || cancelled) return
      busy = true
      try {
        const state = await api('state', { roomCode: game.roomCode })
        if (!cancelled && state?.roomCode) {
          setGame(state as GameState)
          setSyncIssue(false)
        }
      } catch {
        if (!cancelled) setSyncIssue(true)
      } finally { busy = false }
    }
    void refresh()
    const id = window.setInterval(() => { void refresh() }, 2000)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [game.roomCode, game.status, demo])

  const me = game.players.find(p => p.id === playerId)
  const isHost = !!me?.isHost

  const updateDemo = (patch: Partial<GameState>) => setGame(prev => ({ ...prev, ...patch }))

  const createGame = async () => {
    setError('')
    if (!name.trim()) return setError('Enter a display name first.')
    if (!supabase) { const code = randomCode(); const player = { id: playerId, name: name.trim(), score: 0, connected: true, isHost: true }; updateDemo({ roomCode: code, status: 'lobby', roundEndsAt: null, players: [player] }); setRoomCode(code); setScreen('lobby'); return }
    try { const data = await api('create', { name: name.trim() }); setPlayerId(data.playerId); setRoomCode(data.roomCode); localStorage.setItem('vault-five-player', data.playerId); localStorage.setItem(activeRoomStorage, data.roomCode); setGame(data as GameState); setDemo(false); setScreen('lobby') } catch(e) { setError(e instanceof Error ? e.message : 'Could not create the room.') }
  }
  const joinGame = async () => {
    setError('')
    if (!name.trim()) return setError('Enter a display name first.')
    if (roomCode.trim().length !== 4) return setError('Enter the 4-character room code.')
    if (!supabase) { const next = { ...game, roomCode: roomCode.toUpperCase(), players: [...game.players, { id: playerId, name: name.trim(), score: 0, connected: true }] }; updateDemo(next); setScreen('lobby'); return }
    try { const data = await api('join', { roomCode:roomCode.toUpperCase(), name:name.trim() }); setPlayerId(data.playerId); setRoomCode(data.roomCode); localStorage.setItem('vault-five-player', data.playerId); setGame(data as GameState); setDemo(false); setScreen('lobby') } catch(e) { setError(e instanceof Error ? e.message : 'Could not join the room.') }
  }
  const startGame = async () => {
    if (game.players.length < 2) return setError('At least two players are required to start.')
    if (supabase && !demo) { try { await api('start',{roomCode:game.roomCode,playerId}); const state = await api('state',{roomCode:game.roomCode}); setGame(state as GameState); return } catch(e){ return setError(e instanceof Error ? e.message : 'Could not start the game.') } }
    updateDemo({ status: 'round1', roundEndsAt: Date.now() + 45000 }); setScreen('round1')
  }

  const submitRound = async (answer: string) => {
    if (supabase && !demo) { try { await api('round',{roomCode:game.roomCode,playerId,answer}); const state = await api('state',{roomCode:game.roomCode}); setGame(state as GameState); return } catch(e){ return setError(e instanceof Error ? e.message : 'Could not submit.') } }
    const correct = ['33333','22222','11111','00001'].includes(answer)
    const players = game.players.map(p => p.id === playerId ? { ...p, score: p.score + (correct ? 100 : 0), submitted: true } : p); updateDemo({ players, status: 'round2', roundEndsAt: Date.now() + 35000 }); setScreen('round2')
  }

  const submitRound2 = async (answer: string) => {
    if (supabase && !demo) { try { await api('round',{roomCode:game.roomCode,playerId,answer}); return } catch(e){ return setError(e instanceof Error ? e.message : 'Could not submit.') } }
    const correct = answer === 'A'
    const players = game.players.map(p => p.id === playerId ? { ...p, score: p.score + (correct ? 200 : 0), submitted: true } : p); updateDemo({ players, status: 'final', roundEndsAt: Date.now() + 60000 }); setScreen('final')
  }

  const unlock = async (answer: string) => {
    if (vaultBusy) return
    setError('')
    setVaultFeedback('')
    setVaultBusy(true)
    try {
      if (supabase && !demo) {
        const response = await api('vault', { roomCode: game.roomCode, playerId, answer })
        const state = await api('state', { roomCode: game.roomCode })
        if (state?.roomCode) setGame(state as GameState)
        setVaultFeedback(response?.correct ? 'Vault unlocked! Winner confirmed.' : 'Combination received. Incorrect code — the vault remains locked.')
        return
      }
      setVaultFeedback('Local demo mode cannot validate a live vault key.')
    } catch (e) {
      setVaultFeedback(e instanceof Error ? e.message : 'Unable to submit. Please try again.')
    } finally {
      setVaultBusy(false)
    }
  }

  const reset = async () => {
    if (supabase && !demo) {
      try { await api('replay', { roomCode: game.roomCode }); const state = await api('state',{roomCode:game.roomCode}); setGame(state as GameState); return }
      catch (e) { setError(e instanceof Error ? e.message : 'Could not restart the game.'); return }
    }
    const player = game.players.find(p => p.id === playerId)
    const next = { ...initialDemo, roomCode: game.roomCode, players: player ? [{ ...player, score: 0, submitted: false }] : [] }
    updateDemo(next); setScreen('lobby')
  }

  return <div className="app-shell">
    <div className="noise" />
    <header className="topbar">
      <button className="brand" onClick={() => setScreen('home')}><span className="brand-mark"><LockKeyhole size={17}/></span><span><b>VAULT</b><small>FIVE</small></span></button>
      <div className="top-status"><span className={`status-dot ${supabase && !demo ? 'live' : 'demo'}`} /> {supabase && !demo ? 'LIVE SERVER' : 'LOCAL PLAY MODE'}</div>
    </header>

    {syncIssue && <div className="error" role="status">Connection interrupted. Reconnecting to the room…</div>}
    <main>
      {screen === 'home' && <Home onCreate={() => setScreen('create')} onJoin={() => setScreen('join')} onHow={() => setScreen('howto')} />}
      {screen === 'create' && <NameCard title="Create a game" subtitle="Start a room and share the code with your friends." name={name} setName={setName} error={error} onBack={() => setScreen('home')} action={createGame} actionText="Create my game" />}
      {screen === 'join' && <JoinCard roomCode={roomCode} setRoomCode={setRoomCode} name={name} setName={setName} error={error} onBack={() => setScreen('home')} action={joinGame} />}
      {screen === 'howto' && <HowTo onBack={() => setScreen('home')} />}
      {screen === 'lobby' && <Lobby game={game} isHost={isHost} onStart={startGame} onHow={() => setScreen('howto')} onCopy={() => { navigator.clipboard?.writeText(game.roomCode); setNotice('Room code copied.') }} error={error} notice={notice} />}
      {screen === 'round1' && <RoundOne onSubmit={submitRound} endsAt={game.roundEndsAt} />}
      {screen === 'round2' && <RoundTwo onSubmit={submitRound2} endsAt={game.roundEndsAt} />}
      {screen === 'final' && <FinalVault onUnlock={unlock} endsAt={game.roundEndsAt} feedback={vaultFeedback} busy={vaultBusy} />}
      {screen === 'result' && <Result game={game} playerId={playerId} onReplay={reset} />}
    </main>
    <footer><span>Fictional game experience · No real-money prizes</span><span>VAULT FIVE / 01</span></footer>
  </div>
}

function Home({ onCreate, onJoin, onHow }: {onCreate:()=>void;onJoin:()=>void;onHow:()=>void}) {
 return <section className="hero page-grid"><div className="hero-copy"><div className="eyebrow"><Radio size={13}/> A LIVE MULTIPLAYER PARTY GAME</div><h1>Five digits.<br/><em>One vault.</em><br/>Outsmart the room.</h1><p>Read the clues, beat the clock and be the first to crack the final digital safe. No accounts. No downloads.</p><div className="cta-row"><button className="primary" onClick={onCreate}><Plus size={18}/> Create a game <ArrowRight size={17}/></button><button className="secondary" onClick={onJoin}><LogIn size={18}/> Join a game</button></div><button className="text-button" onClick={onHow}>How it works <ArrowRight size={14}/></button></div><div className="vault-art"><div className="orb orb-one"/><div className="orb orb-two"/><div className="vault-ring"><LockKeyhole size={54}/><span>SAFE BOX</span><strong>•••••</strong></div><div className="floating-card card-a"><span>PLAYERS</span><b>2–8</b></div><div className="floating-card card-b"><span>ROOM CODE</span><b>7K4P</b></div></div></section>
}

function NameCard({title,subtitle,name,setName,error,onBack,action,actionText}:{title:string;subtitle:string;name:string;setName:(v:string)=>void;error:string;onBack:()=>void;action:()=>void;actionText:string}) {
 return <section className="center-page"><div className="panel narrow"><div className="panel-icon"><Users/></div><div className="eyebrow">NEW ROOM</div><h2>{title}</h2><p>{subtitle}</p><label>Your display name<input autoFocus value={name} maxLength={18} onChange={e=>setName(e.target.value)} placeholder="e.g. Alex" /></label>{error&&<div className="error"><X size={15}/>{error}</div>}<button className="primary full" onClick={action}>{actionText}<ArrowRight size={17}/></button><button className="text-button" onClick={onBack}>Back</button></div></section>
}
function JoinCard({roomCode,setRoomCode,name,setName,error,onBack,action}:{roomCode:string;setRoomCode:(v:string)=>void;name:string;setName:(v:string)=>void;error:string;onBack:()=>void;action:()=>void}) {
 return <section className="center-page"><div className="panel narrow"><div className="panel-icon"><LogIn/></div><div className="eyebrow">JOIN ROOM</div><h2>Enter the room.</h2><p>Use the four-character code shared by the host.</p><label>Room code<input autoFocus className="code-input" value={roomCode} maxLength={4} onChange={e=>setRoomCode(e.target.value.toUpperCase())} placeholder="7K4P" /></label><label>Your display name<input value={name} maxLength={18} onChange={e=>setName(e.target.value)} placeholder="e.g. Jordan" /></label>{error&&<div className="error"><X size={15}/>{error}</div>}<button className="primary full" onClick={action}>Join the game <ArrowRight size={17}/></button><button className="text-button" onClick={onBack}>Back</button></div></section>
}

function HowTo({onBack}:{onBack:()=>void}) { return <section className="center-page"><div className="panel rules"><div className="eyebrow">THE RULES</div><h2>Three rounds. One vault.</h2><div className="rules-grid"><Rule n="01" title="Discover" text="The six outputs are numbered 1–6. The vault ignores outputs 1 and 2; identify a contributing signal."/><Rule n="02" title="Deduce" text="The remaining four outputs are added to a starting value of 02001. Choose the pair containing outputs 3 and 4."/><Rule n="03" title="Unlock" text="Add the starting value and the four included outputs. Enter the five-digit total before time runs out."/></div><div className="legal-note"><ShieldCheck size={17}/> $1,000,000 is fictional and has no cash value.</div><button className="secondary" onClick={onBack}>Back to lobby</button></div></section> }
function Rule({n,title,text}:{n:string;title:string;text:string}) {return <div className="rule"><span>{n}</span><div><h3>{title}</h3><p>{text}</p></div></div>}

function Lobby({game,isHost,onStart,onHow,onCopy,error,notice}:{game:GameState;isHost:boolean;onStart:()=>void;onHow:()=>void;onCopy:()=>void;error:string;notice:string}) { return <section className="center-page"><div className="panel lobby"><div className="lobby-head"><div><div className="eyebrow">YOUR ROOM</div><h2>{game.roomCode}</h2><p>Share this code. Friends can join from any phone or laptop.</p></div><button className="copy" onClick={onCopy}><Copy size={16}/> Copy</button></div><div className="players-head"><span>PLAYERS</span><b>{game.players.length}/8</b></div><div className="player-list">{game.players.map((p,i)=><div className="player" key={p.id}><span className="avatar">{p.name.slice(0,1).toUpperCase()}</span><span>{p.name}{p.isHost&&<small>HOST</small>}</span><i>{p.isHost?<Crown size={15}/>:<span className="ready-dot"/>}</i></div>)}{Array.from({length:Math.max(0,2-game.players.length)}).map((_,i)=><div className="player waiting" key={i}><span className="avatar">?</span><span>Waiting for player...</span><i><span className="pulse"/></i></div>)}</div>{error&&<div className="error"><X size={15}/>{error}</div>}{notice&&<div className="notice"><Check size={15}/>{notice}</div>}<div className="lobby-actions">{isHost ? <button className="primary full" onClick={onStart}>Start game <ArrowRight size={17}/></button> : <div className="waiting-host"><span className="pulse"/> Waiting for the host to start…</div>}<button className="text-button" onClick={onHow}>Review rules</button></div></div></section> }

function RoundOne({onSubmit,endsAt}:{onSubmit:(answer:string)=>void;endsAt:number|null}) { const [pick,setPick]=useState(''); return <GameFrame round="01" title="Find the signal" subtitle="Six numbered signals feed the safe. Signals 1 and 2 are decoys. Choose any one of signals 3–6 to earn points." timer={45} endsAt={endsAt}><div className="signal-grid">{['55555','44444','33333','22222','11111','00001'].map((v,i)=><button key={v} className={`signal ${pick===v?'selected':''}`} onClick={()=>setPick(v)}><small>SIGNAL {i+1}</small><strong>{v}</strong></button>)}</div><button disabled={!pick} className="primary full" onClick={()=>onSubmit(pick)}>Lock in <Check size={17}/></button></GameFrame> }
function RoundTwo({onSubmit,endsAt}:{onSubmit:(answer:string)=>void;endsAt:number|null}) { const [pick,setPick]=useState(''); return <GameFrame round="02" title="Read the pattern" subtitle="The vault skips signals 1 and 2. Which pair represents signals 3 and 4?" timer={35} endsAt={endsAt}><div className="choice-stack">{[['A','33 · 22'],['B','55 · 44'],['C','11 · 00']].map(([a,b])=><button key={a} className={`big-choice ${pick===a?'selected':''}`} onClick={()=>setPick(a)}><span>{a}</span><strong>{b}</strong><ArrowRight size={18}/></button>)}</div><button disabled={!pick} className="primary full" onClick={()=>onSubmit(pick)}>Lock in <Check size={17}/></button></GameFrame> }
function FinalVault({onUnlock,endsAt,feedback,busy}:{onUnlock:(a:string)=>void;endsAt:number|null;feedback:string;busy:boolean}) {
 const [digits,setDigits]=useState('')
 return <GameFrame round="FINAL" title="The vault is ready." subtitle="Calculate: start with 02001, then add signals 3, 4, 5 and 6 from Round 1. Enter the five-digit sum." timer={60} endsAt={endsAt}>
 <div className="vault-input"><div className="digits">{Array.from({length:5}).map((_,i)=><span key={i}>{digits[i]||'•'}</span>)}</div>
 <div className="keypad">{['1','2','3','4','5','6','7','8','9','0'].map(d=><button key={d} disabled={busy} onClick={()=>digits.length<5&&setDigits(digits+d)}>{d}</button>)}<button className="clear" disabled={busy} onClick={()=>setDigits('')}><RotateCcw size={17}/></button></div></div>
 <button disabled={digits.length!==5||busy} className="primary full" onClick={()=>onUnlock(digits)}>{busy?'Checking combination…':'Unlock vault'} <LockKeyhole size={17}/></button>
 {feedback&&<div className="notice" role="status" aria-live="polite">{feedback}</div>}
 </GameFrame>
}
function GameFrame({round,title,subtitle,timer,endsAt,children}:{round:string;title:string;subtitle:string;timer:number;endsAt:number|null;children:React.ReactNode}) {
 const remaining = () => Math.max(0,Math.ceil(((endsAt ?? (Date.now()+timer*1000))-Date.now())/1000))
 const [left,setLeft]=useState(remaining)
 useEffect(()=>{setLeft(remaining());const id=window.setInterval(()=>setLeft(remaining()),250);return()=>window.clearInterval(id)},[endsAt,timer])
 return <section className="game-page"><div className="game-meta"><span>ROUND {round}</span><span><span className="pulse"/> LIVE ROOM</span></div><div className="game-layout"><div className="game-copy"><div className="eyebrow"><Sparkles size={13}/> THE VAULT IS WATCHING</div><h2>{title}</h2><p>{subtitle}</p><div className={`timer ${left<=10?'urgent':''}`}><span>TIME REMAINING</span><strong>00:{String(left).padStart(2,'0')}</strong></div></div><div className="panel game-panel">{children}</div></div></section>
}
function Result({game,playerId,onReplay}:{game:GameState;playerId:string;onReplay:()=>void}) { const me=game.players.find(p=>p.id===playerId); return <section className="center-page"><div className="panel result"><div className={`result-lock ${game.vaultUnlocked?'unlocked':''}`}><LockKeyhole size={38}/></div><div className="eyebrow">{game.vaultUnlocked?'VAULT OPEN':'VAULT SECURED'}</div><h2>{game.vaultUnlocked?'JACKPOT':'Not this time.'}</h2><p>{game.vaultUnlocked?'The fictional prize has been unlocked.':'The vault stays closed. Play again and sharpen your deduction.'}</p>{game.vaultUnlocked&&<div className="prize"><small>FICTIONAL JACKPOT</small><strong>$1,000,000</strong><span>Safe box unlocked · no cash value</span></div>}<div className="score-row"><span>Your score</span><b>{me?.score ?? 0}</b></div><button className="primary full" onClick={onReplay}>Play again <RotateCcw size={17}/></button></div></section> }

function randomCode(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return Array.from({length:4},()=>chars[Math.floor(Math.random()*chars.length)]).join('')}

createRoot(document.getElementById('root')!).render(<App />)
