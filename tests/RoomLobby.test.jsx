import React from 'react'
import { beforeEach, afterEach, test, expect, vi } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
vi.mock('../src/lib/supabaseClient.js',()=>({supabase:{}}))
vi.mock('../src/lib/roomApi.js',()=>({
 ensureRoomIdentity:vi.fn().mockResolvedValue({}),
 createRoom:vi.fn(),joinRoom:vi.fn(),readRoom:vi.fn(),startRoom:vi.fn(),leaveRoom:vi.fn().mockResolvedValue(),
}))
import * as rooms from '../src/lib/roomApi.js'
import RoomLobby from '../src/RoomLobby.jsx'
const room={id:'room',code:'ABC123',status:'waiting',config:{paceIdx:1}}
beforeEach(()=>{
 vi.useFakeTimers()
 vi.clearAllMocks()
 rooms.joinRoom.mockResolvedValue({room,player:{id:'player'}})
 rooms.readRoom.mockResolvedValue({room,players:[{id:'player',nickname:'runner'}]})
})
afterEach(()=>{cleanup();vi.useRealTimers()})
test('automatic start uses actual participant ID, does not leave on transfer, and polls once at a time',async()=>{
 const onStart=vi.fn().mockResolvedValue(true)
 const {unmount}=render(<RoomLobby onStart={onStart} onBack={()=>{}} />)
 fireEvent.click(screen.getByText('코드로 참가하기'))
 fireEvent.change(screen.getByLabelText('방 코드'),{target:{value:'ABC123'}})
 fireEvent.change(screen.getByLabelText('내 닉네임'),{target:{value:'runner'}})
 await act(async()=>fireEvent.click(screen.getByText('참가하기')))
 rooms.readRoom.mockResolvedValue({room:{...room,status:'started'},players:[]})
 await act(async()=>vi.advanceTimersByTimeAsync(3000))
 expect(onStart).toHaveBeenCalledExactlyOnceWith(room.config,{
  roomId:'room',roomCode:'ABC123',playerId:'player',nickname:'runner',
 })
 unmount()
 expect(rooms.leaveRoom).not.toHaveBeenCalled()
})
test('failed position lookup keeps lobby retry available',async()=>{
 const onStart=vi.fn().mockResolvedValue(false)
 render(<RoomLobby onStart={onStart} onBack={()=>{}} />)
 fireEvent.click(screen.getByText('코드로 참가하기'))
 fireEvent.change(screen.getByLabelText('방 코드'),{target:{value:'ABC123'}})
 fireEvent.change(screen.getByLabelText('내 닉네임'),{target:{value:'runner'}})
 await act(async()=>fireEvent.click(screen.getByText('참가하기')))
 rooms.readRoom.mockResolvedValue({room:{...room,status:'started'},players:[]})
 await act(async()=>vi.advanceTimersByTimeAsync(3000))
 expect(screen.getByText('위치 확인 후 다시 시작')).toBeTruthy()
 await act(async()=>fireEvent.click(screen.getByText('위치 확인 후 다시 시작')))
 expect(onStart).toHaveBeenCalledTimes(2)
})

test.each([false,true])('authored map selection is explicit when creating and starting a room (selected: %s)',async selected=>{
 const map={id:'authored-map',name:'공원',radius:400}
 const config=selected ? {paceIdx:1,mapId:map.id} : {paceIdx:1,playMode:'free',radiusIdx:1}
 const createdRoom={...room,config}
 const onStart=vi.fn().mockResolvedValue(true)
 rooms.createRoom.mockResolvedValue({room:createdRoom,player:{id:'host'}})
 rooms.readRoom.mockResolvedValue({room:createdRoom,players:[{id:'host',nickname:'runner'}]})
 rooms.startRoom.mockResolvedValue({...createdRoom,status:'started'})
 render(<RoomLobby zombieMaps={[map]} onStart={onStart} onBack={()=>{}} />)
 fireEvent.click(screen.getByRole('button',{name:'방 만들기 (방장)'}))
 fireEvent.change(screen.getByLabelText('방장 닉네임'),{target:{value:'runner'}})
 fireEvent.click(screen.getByRole('button',{name:'🗺️ 공원'}))
 if (!selected) {
  fireEvent.click(screen.getByRole('button',{name:'지도 선택 안 함'}))
  fireEvent.click(screen.getByRole('button',{name:'자유 모드'}))
 }
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'방 만들기',exact:true})))
 expect(rooms.createRoom).toHaveBeenCalledExactlyOnceWith('runner',config)
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'다같이 시작하기 (1명)'})))
 expect(onStart).toHaveBeenCalledExactlyOnceWith(config,{
  roomId:'room',roomCode:'ABC123',playerId:'host',nickname:'runner',
 })
})

