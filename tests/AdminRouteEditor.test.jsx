import React from 'react'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
const state = vi.hoisted(() => ({ props: null, payload: null, rows: [] }))
vi.mock('../src/AdminMap.jsx', () => ({ default: props => { state.props = props; return <div data-testid="editor-map" /> } }))
vi.mock('../src/lib/supabaseClient.js', () => ({ supabaseProjectRef: null, supabase: {
  from: () => {
    const query = { select: () => query, order: () => query, eq: () => query,
      then: resolve => resolve({ data: state.rows }),
      insert: payload => { state.payload = payload; return query },
      update: payload => { state.payload = payload; return query },
      single: async () => ({ data: { id: 'saved' }, error: null }),
    }
    return query
  },
} }))
import AdminRouteEditor from '../src/AdminRouteEditor.jsx'
const p = (x,y) => ({ lat: 37+y/1000, lon:127+x/1000 })
beforeEach(() => {
  state.rows=[]; state.payload=null
  window.history.replaceState({}, '', '/')
  Object.defineProperty(navigator,'geolocation',{ configurable:true,value:{getCurrentPosition: success => success({coords:{latitude:37,longitude:127}})} })
})
afterEach(cleanup)
async function open() { await act(async () => render(<AdminRouteEditor session={{user:{id:'owner'}}} onBack={()=>{}} />)) }
const clickPoint = point => act(() => state.props.onMapClick(point))
test('second circle click and repeated flag clicks keep a finite radius', async () => {
  await open()
  fireEvent.click(screen.getByRole('button',{name:'원형 구역'}))
  clickPoint(p(0,0)); clickPoint(p(2,0))
  expect(state.props.radius).toBeGreaterThan(100)
  expect(Number.isFinite(state.props.radius)).toBe(true)
  clickPoint(p(0,0)); clickPoint(p(0,0))
  expect(state.props.radius).toBe(100)
  expect(screen.getByTestId('editor-map')).toBeTruthy()
})
test('clicked polygon saves and loads with the same boundary; outside route points are rejected', async () => {
  await open()
  fireEvent.change(screen.getByLabelText('지도 이름'),{target:{value:'자유 구역'}})
  const boundary=[p(0,0),p(4,0),p(4,4),p(0,4)]
  boundary.forEach(clickPoint)
  fireEvent.click(screen.getByRole('button',{name:/구역 확정/}))
  clickPoint(p(1,1)); clickPoint(p(5,1))
  expect(state.props.currentRoute).toHaveLength(1)
  expect(screen.getByRole('alert').textContent).toContain('구역 밖')
  clickPoint(p(2,2))
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'이 지도 저장하기'})))
  expect(state.payload.boundary).toEqual(boundary)
  expect(state.payload.routes).toEqual([[p(1,1),p(2,2)]])
  const saved={...state.payload,id:'saved'}
  cleanup(); state.rows=[saved]
  await open()
  fireEvent.click(screen.getByTitle('불러오기'))
  expect(state.props.boundary).toEqual(boundary)
})
test('dragged boundary can be edited and invalid crossings cannot be confirmed', async () => {
  await open()
  fireEvent.change(screen.getByLabelText('지도 이름'),{target:{value:'드래그'}})
  fireEvent.click(screen.getByRole('button',{name:'드래그 그리기'}))
  act(()=>state.props.onBoundaryChange([p(0,0),p(4,4),p(0,4),p(4,0)]))
  fireEvent.click(screen.getByRole('button',{name:/구역 확정/}))
  expect(screen.getByRole('alert').textContent).toContain('교차')
  fireEvent.click(screen.getByRole('button',{name:'구역 점 취소'}))
  expect(state.props.boundary).toHaveLength(3)
})
