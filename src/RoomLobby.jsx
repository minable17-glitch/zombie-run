import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabaseClient.js'
import { AREA_RADIUS_PRESETS, DEFAULT_PACE_IDX, DEFAULT_RADIUS_IDX, PACE_PRESETS } from './lib/gameConfig.js'

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 헷갈리는 0/O, 1/I 제외
const POLL_MS = 3000

function randomCode(len = 5) {
  let s = ''
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  return s
}

// 관리자(방장)가 방을 만들고 코드를 공유하면, 참가자들이 그 코드로 들어와 대기하다가
// 방장이 시작을 누르면 전원이 동시에 같은 설정(페이스/모드)으로 게임을 시작하는 화면.
// "따로 모드": 각자 자기 좀비를 만나지만, 서로의 생존 상태는 주기적으로 공유됨(App.jsx가 담당)
export default function RoomLobby({ onBack, onStart }) {
  const [step, setStep] = useState('choose') // 'choose' | 'create' | 'join' | 'waiting'
  const [nickname, setNickname] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [paceIdx, setPaceIdx] = useState(DEFAULT_PACE_IDX)
  const [playMode, setPlayMode] = useState('free')
  const [radiusIdx, setRadiusIdx] = useState(DEFAULT_RADIUS_IDX)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [room, setRoom] = useState(null) // { id, code, status, config }
  const [playerId, setPlayerId] = useState(null)
  const [isHost, setIsHost] = useState(false)
  const [players, setPlayers] = useState([])
  const pollRef = useRef(null)

  useEffect(() => {
    return () => clearInterval(pollRef.current)
  }, [])

  if (!supabase) {
    return (
      <div className="zr-screen zr-start">
        <div className="zr-start-card">
          <h1 className="zr-title">👥 그룹으로 같이 뛰기</h1>
          <p className="zr-error">저장소가 아직 연결 안 됐어요. 관리자에게 Supabase 설정을 문의하세요.</p>
          <button className="zr-btn zr-btn-ghost" onClick={onBack}>
            돌아가기
          </button>
        </div>
      </div>
    )
  }

  const pollRoom = async (roomId) => {
    const [{ data: roomRow }, { data: playerRows }] = await Promise.all([
      supabase.from('game_rooms').select('*').eq('id', roomId).single(),
      supabase.from('room_players').select('*').eq('room_id', roomId).order('joined_at', { ascending: true }),
    ])
    if (playerRows) setPlayers(playerRows)
    if (roomRow) {
      setRoom(roomRow)
      if (roomRow.status === 'started') {
        clearInterval(pollRef.current)
        onStart(roomRow.config, {
          roomId: roomRow.id,
          roomCode: roomRow.code,
          playerId,
          nickname: nickname.trim() || '참가자',
        })
      }
    }
  }

  const startPolling = (roomId) => {
    clearInterval(pollRef.current)
    pollRoom(roomId)
    pollRef.current = setInterval(() => pollRoom(roomId), POLL_MS)
  }

  const createRoom = async () => {
    if (!nickname.trim()) {
      setError('닉네임을 입력해주세요.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const code = randomCode()
      const config = { paceIdx, playMode, radiusIdx }
      const { data: roomRow, error: roomErr } = await supabase
        .from('game_rooms')
        .insert({ code, host_name: nickname.trim(), status: 'waiting', config })
        .select()
        .single()
      if (roomErr) throw roomErr
      const { data: playerRow, error: playerErr } = await supabase
        .from('room_players')
        .insert({ room_id: roomRow.id, nickname: nickname.trim() })
        .select()
        .single()
      if (playerErr) throw playerErr
      setRoom(roomRow)
      setPlayerId(playerRow.id)
      setIsHost(true)
      setStep('waiting')
      startPolling(roomRow.id)
    } catch (e) {
      setError(e.message || '방을 만들지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  const joinRoom = async () => {
    if (!nickname.trim() || !joinCode.trim()) {
      setError('코드와 닉네임을 모두 입력해주세요.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const { data: roomRow, error: roomErr } = await supabase
        .from('game_rooms')
        .select('*')
        .eq('code', joinCode.trim().toUpperCase())
        .maybeSingle()
      if (roomErr) throw roomErr
      if (!roomRow) throw new Error('그 코드로 된 방을 찾을 수 없어요.')
      if (roomRow.status !== 'waiting') throw new Error('이미 시작된 방이에요.')
      const { data: playerRow, error: playerErr } = await supabase
        .from('room_players')
        .insert({ room_id: roomRow.id, nickname: nickname.trim() })
        .select()
        .single()
      if (playerErr) throw playerErr
      setRoom(roomRow)
      setPlayerId(playerRow.id)
      setIsHost(false)
      setStep('waiting')
      startPolling(roomRow.id)
    } catch (e) {
      setError(e.message || '참가하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  const startGame = async () => {
    if (!room) return
    setBusy(true)
    setError('')
    try {
      const { error: err } = await supabase
        .from('game_rooms')
        .update({ status: 'started', started_at: new Date().toISOString() })
        .eq('id', room.id)
      if (err) throw err
      clearInterval(pollRef.current)
      onStart(room.config, { roomId: room.id, roomCode: room.code, playerId, nickname: nickname.trim() || '참가자' })
    } catch (e) {
      setError(e.message || '시작하지 못했어요.')
      setBusy(false)
    }
  }

  if (step === 'choose') {
    return (
      <div className="zr-screen zr-start">
        <div className="zr-start-card">
          <h1 className="zr-title">👥 그룹으로 같이 뛰기</h1>
          <p className="zr-subtitle">
            방을 만들어 코드를 공유하면, 참가자들이 다 들어온 뒤 다같이 시작할 수 있어요. 시작하면 각자 자기
            좀비를 만나지만, 서로의 거리·생존 상태는 실시간으로 볼 수 있어요.
          </p>
          <button className="zr-btn zr-btn-primary" onClick={() => setStep('create')}>
            방 만들기 (관리자)
          </button>
          <button className="zr-btn zr-btn-ghost" onClick={() => setStep('join')}>
            코드로 참가하기
          </button>
          <button className="zr-btn zr-btn-ghost" onClick={onBack}>
            돌아가기
          </button>
        </div>
      </div>
    )
  }

  if (step === 'create') {
    return (
      <div className="zr-screen zr-start">
        <div className="zr-start-card">
          <h1 className="zr-title">방 만들기</h1>
          <input
            className="zr-admin-input"
            placeholder="내 닉네임 (방장)"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
          <p className="zr-pace-label">목표 페이스 (모두에게 적용)</p>
          <div className="zr-pace-picker">
            {PACE_PRESETS.map((p, i) => (
              <button
                key={p.label}
                className={i === paceIdx ? 'zr-pace-btn zr-pace-btn-on' : 'zr-pace-btn'}
                onClick={() => setPaceIdx(i)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="zr-pace-label">플레이 모드</p>
          <div className="zr-pace-picker zr-pace-picker-2col">
            <button
              className={playMode === 'free' ? 'zr-pace-btn zr-pace-btn-on' : 'zr-pace-btn'}
              onClick={() => setPlayMode('free')}
            >
              자유 모드
            </button>
            <button
              className={playMode === 'restricted' ? 'zr-pace-btn zr-pace-btn-on' : 'zr-pace-btn'}
              onClick={() => setPlayMode('restricted')}
            >
              제한구역 모드
            </button>
          </div>
          {playMode === 'restricted' && (
            <div className="zr-pace-picker">
              {AREA_RADIUS_PRESETS.map((r, i) => (
                <button
                  key={r}
                  className={i === radiusIdx ? 'zr-pace-btn zr-pace-btn-on' : 'zr-pace-btn'}
                  onClick={() => setRadiusIdx(i)}
                >
                  {r >= 1000 ? `${r / 1000}km` : `${r}m`}
                </button>
              ))}
            </div>
          )}
          {error && <p className="zr-error">{error}</p>}
          <button className="zr-btn zr-btn-primary" onClick={createRoom} disabled={busy}>
            {busy ? '만드는 중…' : '방 만들기'}
          </button>
          <button className="zr-btn zr-btn-ghost" onClick={() => setStep('choose')}>
            뒤로
          </button>
        </div>
      </div>
    )
  }

  if (step === 'join') {
    return (
      <div className="zr-screen zr-start">
        <div className="zr-start-card">
          <h1 className="zr-title">코드로 참가하기</h1>
          <input
            className="zr-admin-input"
            placeholder="방 코드"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            style={{ textAlign: 'center', fontSize: 22, letterSpacing: 4, textTransform: 'uppercase' }}
          />
          <input
            className="zr-admin-input"
            placeholder="내 닉네임"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
          {error && <p className="zr-error">{error}</p>}
          <button className="zr-btn zr-btn-primary" onClick={joinRoom} disabled={busy}>
            {busy ? '참가하는 중…' : '참가하기'}
          </button>
          <button className="zr-btn zr-btn-ghost" onClick={() => setStep('choose')}>
            뒤로
          </button>
        </div>
      </div>
    )
  }

  // step === 'waiting'
  return (
    <div className="zr-screen zr-start">
      <div className="zr-start-card">
        <h1 className="zr-title">대기실</h1>
        <p className="zr-subtitle">이 코드를 다른 사람들에게 알려주세요</p>
        <div className="zr-room-code">{room?.code}</div>
        <p className="zr-pace-label" style={{ marginTop: 18 }}>
          참가자 ({players.length}명)
        </p>
        <div className="zr-admin-route-list">
          {players.map((p) => (
            <span key={p.id} className="zr-admin-route-chip">
              {p.nickname}
              {p.id === playerId ? ' (나)' : ''}
            </span>
          ))}
        </div>
        {error && <p className="zr-error">{error}</p>}
        {isHost ? (
          <button className="zr-btn zr-btn-primary" onClick={startGame} disabled={busy}>
            {busy ? '시작하는 중…' : `다같이 시작하기 (${players.length}명)`}
          </button>
        ) : (
          <p className="zr-pace-hint" style={{ textAlign: 'center', marginTop: 14 }}>
            방장이 시작하면 자동으로 게임이 시작돼요…
          </p>
        )}
        <button className="zr-btn zr-btn-ghost" onClick={onBack}>
          나가기
        </button>
      </div>
    </div>
  )
}
