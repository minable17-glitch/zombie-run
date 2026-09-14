import React from 'react'
import { test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../src/lib/authLanding.js', () => ({
  accountLanding: false,
  passwordRecoveryExpired: true,
}))
vi.mock('../src/lib/supabaseClient.js', () => ({ supabase: {
  auth: {
    getSession: async () => ({ data: { session: { user: { id: 'existing-user' } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { username: 'runner' } }) }) }) }),
} }))
vi.mock('../src/lib/authHelpers.js', () => ({
  ensureOwnProfile: async () => {},
  authRequest: vi.fn(),
  loginWithUsername: vi.fn(),
  normalizeUsername: value => value.trim().toLowerCase(),
  siteUrl: () => 'https://example.test/',
}))
vi.mock('../src/lib/zombieMaps.js', () => ({ fetchZombieMaps: async () => [] }))
vi.mock('../src/GameMap.jsx', () => ({ default: () => null }))
vi.mock('../src/AdminRouteEditor.jsx', () => ({ default: () => <p>지도 편집기</p> }))
import App from '../src/App.jsx'

test('expired recovery guidance wins even when an old signed-in session exists', async () => {
  render(<App />)
  expect(screen.getByRole('status').textContent).toContain('만료')
  expect(screen.getAllByRole('button', { name: '비번 찾기' })).toHaveLength(2)
  expect(screen.queryByText('지도 편집기')).toBeNull()
})
