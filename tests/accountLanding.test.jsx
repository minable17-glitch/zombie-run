import React from 'react'
import { test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('../src/lib/authLanding.js', () => ({ accountLanding: true }))
vi.mock('../src/lib/supabaseClient.js', () => ({ supabase: {
  auth: {
    getSession: async () => ({ data: { session: { user: { id: 'own-user' } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { username: 'runner123' } }) }) }) }),
} }))
vi.mock('../src/lib/authHelpers.js', () => ({ ensureOwnProfile: async () => {} }))
vi.mock('../src/lib/zombieMaps.js', () => ({ fetchZombieMaps: async () => [] }))
vi.mock('../src/GameMap.jsx', () => ({ default: () => null }))
vi.mock('../src/AdminRouteEditor.jsx', () => ({ default: () => null }))
import App from '../src/App.jsx'

test('email recovery displays the verified username even after SDK removes URL markers', async () => {
  window.history.replaceState({}, '', '/')
  render(<React.StrictMode><App /></React.StrictMode>)
  expect(await screen.findByText('runner123')).toBeTruthy()
  expect(screen.getByRole('heading', { name: '아이디 찾기' })).toBeTruthy()
  expect(screen.queryByText('도망치기 시작 🏃')).toBeNull()
})
