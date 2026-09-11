import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabaseClient.js'
import { AREA_RADIUS_PRESETS, DEFAULT_PACE_IDX, DEFAULT_RADIUS_IDX, PACE_PRESETS } from './lib/gameConfig.js'
import * as rooms from './lib/roomApi.js'

const POLL_MS = 3000

// 관리자(방장)가 방을 만들고 코드를 공유하면, 참가자들이 그 코드로 들어와 대기하다가
// 방장이 시작을 누르면 전원이 동시에 같은 설정(페이스/모드/지도)으로 게임을 시작하는 화면.
// "따로 모드": 각자 자기 좀비를 만나지만, 서로의 생존 상태는 주기적으로 공유됨(App.jsx가 담당)
export default function RoomLobby({ zombieMaps = [], onBack, onStart, startError }) {
  const [step, setStep] = useState('choose') // 'choose' | 'create' | 'join' | 'waiting'
  const [nickname, setNickname] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [paceIdx, setPaceIdx] = useState(DEFAULT_PACE_IDX)
  const [playMode, setPlayMode] = useState('free')
  const [radiusIdx, setRadiusIdx] = useState(DEFAULT_RADIUS_IDX)
  const [mapId, setMapId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [room, setRoom] = useState(null) // { id, code, status, config }
  const [playerId, setPlayerId] = useState(null)
  const [isHost, setIsHost] = useState(false)
  const [players, setPlayers] = useState([])
  const pollRef = useRef(null)
  const roomRef = useRef(null)
  const transferred = useRef(false)
  const alive = useRef(true)
  const polling = useRef(false)
  const startAttempted = useRef(false)
  const actionBusy = useRef(false)
  const onStartRef = useRef(onStart)
  onStartRef.current = onStart
  const [needsRetry, setNeedsRetry] = useState(false)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      clearTimeout(pollRef.current)
      if (roomRef.current && !transferred.current) rooms.leaveRoom(roomRef.current).catch(() => {})
    }
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

  const enterGame = async (roomRow, id, name) => {
    if (startAttempted.current || !alive.current) return
    startAttempted.current = true
    setBusy(true)
    // The parent can unmount us on success; don't interpret that as leaving.
    transferred.current = true
    try {
      const started = await onStartRef.current(roomRow.config, {
        roomId: roomRow.id, roomCode: roomRow.code, playerId: id, nickname: name,
      })
      if (!started) {
        transferred.current = false
        if (!alive.current) rooms.leaveRoom(roomRow.id).catch(() => {})
        else setNeedsRetry(true)
      }
    } catch {
      transferred.current = false
      if (alive.current) { setError('게임을 시작하지 못했어요. 다시 시도해주세요.'); setNeedsRetry(true) }
    } finally { if (alive.current) setBusy(false) }
  }

  const pollRoom = async (roomId, id, name) => {
    if (!alive.current || polling.current) return
    polling.current = true
    try {
      const result = await rooms.readRoom(roomId)
      if (!alive.current || roomRef.current !== roomId) return
      setPlayers(result.players)
      setRoom(result.room)
      setError('')
      if (result.room.status === 'closed') {
        setError('방장이 방을 닫았어요. 나갔다가 새 방에 참가해주세요.')
        return
      }
      if (result.room.status === 'started') {
        await enterGame(result.room, id, name)
        return
      }
    } catch (e) { if (alive.current) setError(e.message) }
    finally { polling.current = false }
    if (alive.current && roomRef.current === roomId)
      pollRef.current = setTimeout(() => pollRoom(roomId, id, name), POLL_MS)
  }

  const connectRoom = async (create) => {
    if (actionBusy.current) return
    const name = nickname.trim()
    if (!name || (!create && !joinCode.trim())) {
      setError('닉네임과 방 코드를 확인해주세요.')
      return
    }
    actionBusy.current = true
    setBusy(true)
    setError('')
    try {
      await rooms.ensureRoomIdentity()
      if (!alive.current) return
      const config = mapId ? { paceIdx, mapId } : { paceIdx, playMode, radiusIdx }
      const result = create
        ? await rooms.createRoom(name, config)
        : await rooms.joinRoom(joinCode.trim().toUpperCase(), name)
      if (!alive.current) { await rooms.leaveRoom(result.room.id); return }
      roomRef.current = result.room.id
      setRoom(result.room)
      setPlayerId(result.player.id)
      setIsHost(create)
      setStep('waiting')
      startAttempted.current = false
      pollRoom(result.room.id, result.player.id, name)
    } catch (e) { if (alive.current) setError(e.message) }
    finally { actionBusy.current = false; if (alive.current) setBusy(false) }
  }
  const createRoom = () => connectRoom(true)
  const joinRoom = () => connectRoom(false)
  const startGame = async () => {
    if (!room || actionBusy.current) return
    actionBusy.current = true
    setBusy(true)
    setError('')
    try {
      const started = await rooms.startRoom(room.id)
      clearTimeout(pollRef.current)
      await enterGame(started, playerId, nickname.trim())
    } catch (e) { setError(e.message) }
    finally { actionBusy.current = false; if (alive.current) setBusy(false) }
  }
  const exitRoom = async () => {
    if (busy) return
    setBusy(true)
    clearTimeout(pollRef.current)
    try {
      if (roomRef.current) await rooms.leaveRoom(roomRef.current)
      roomRef.current = null
      onBack()
    } catch (e) { setError(e.message); setBusy(false) }
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
            방 만들기 (방장)
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
            placeholder="내 닉네임 (방장)" aria-label="방장 닉네임" maxLength={20}
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
          <p className="zr-pace-label">좀비 경로 (누군가 만들어둔 지도, 선택 사항)</p>
          <div className="zr-admin-route-list">
            <button
              type="button"
              className="zr-admin-route-chip"
              style={{
                cursor: 'pointer',
                font: 'inherit',
                borderColor: mapId === null ? '#ef5350' : undefined,
                background: mapId === null ? 'rgba(239, 83, 80, 0.22)' : undefined,
                color: mapId === null ? '#fff' : undefined,
              }}
              onClick={() => setMapId(null)}
            >
              지도 선택 안 함
            </button>
            {zombieMaps.map((m) => (
              <button
                key={m.id}
                type="button"
                className="zr-admin-route-chip"
                style={{
                  cursor: 'pointer',
                  font: 'inherit',
                  borderColor: m.id === mapId ? '#ef5350' : undefined,
                  background: m.id === mapId ? 'rgba(239, 83, 80, 0.22)' : undefined,
                  color: m.id === mapId ? '#fff' : undefined,
                }}
                onClick={() => setMapId(m.id)}
              >
                🗺️ {m.name}
              </button>
            ))}
          </div>
          {mapId ? (
            <p className="zr-pace-hint">
              선택하면 참가자 전원이 그 위치(반경 {zombieMaps.find((m) => m.id === mapId)?.radius}m 안)로 이동해야
              이 경로의 좀비를 만나요. 다같이 그 장소로 모여주세요!
            </p>
          ) : (
            <>
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
            </>
          )}
          {error && <p className="zr-error">{error}</p>}
          <button className="zr-btn zr-btn-primary" onClick={createRoom} disabled={busy}>
            {busy ? '만드는 중…' : '방 만들기'}
          </button>
          <button className="zr-btn zr-btn-ghost" disabled={busy} onClick={() => setStep('choose')}>
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
            placeholder="방 코드" aria-label="방 코드" maxLength={6}
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            style={{ textAlign: 'center', fontSize: 22, letterSpacing: 4, textTransform: 'uppercase' }}
          />
          <input
            className="zr-admin-input"
            placeholder="내 닉네임" aria-label="내 닉네임" maxLength={20}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
          {error && <p className="zr-error">{error}</p>}
          <button className="zr-btn zr-btn-primary" onClick={joinRoom} disabled={busy}>
            {busy ? '참가하는 중…' : '참가하기'}
          </button>
          <button className="zr-btn zr-btn-ghost" disabled={busy} onClick={() => setStep('choose')}>
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
        {room?.config?.mapId && (
          <p className="zr-pace-hint" style={{ textAlign: 'center' }}>
            🗺️ 선택된 지도: {zombieMaps.find((m) => m.id === room.config.mapId)?.name || '(불러오는 중…)'}
            <br />
            참가자 모두 그 장소로 이동해서 시작해주세요!
          </p>
        )}
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
        {error && <p role="alert" className="zr-error">{error}</p>}
        {startError && <p role="alert" className="zr-error">{startError}</p>}
        {needsRetry ? (
          <button className="zr-btn zr-btn-primary" disabled={busy} onClick={() => {
            startAttempted.current = false
            setNeedsRetry(false)
            enterGame(room, playerId, nickname.trim())
          }}>위치 확인 후 다시 시작</button>
        ) : isHost ? (
          <button className="zr-btn zr-btn-primary" onClick={startGame} disabled={busy}>
            {busy ? '시작하는 중…' : `다같이 시작하기 (${players.length}명)`}
          </button>
        ) : (
          <p className="zr-pace-hint" style={{ textAlign: 'center', marginTop: 14 }}>
            방장이 시작하면 자동으로 게임이 시작돼요…
          </p>
        )}
        <button className="zr-btn zr-btn-ghost" onClick={exitRoom} disabled={busy}>
          나가기
        </button>
      </div>
    </div>
  )
}
