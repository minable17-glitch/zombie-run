import React from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
const state = vi.hoisted(() => ({ updateUser: vi.fn() }))
vi.mock('../src/lib/supabaseClient.js', () => ({ supabase: { auth: { updateUser: state.updateUser } } }))
import ResetPassword from '../src/ResetPassword.jsx'
beforeEach(() => state.updateUser.mockReset())
afterEach(cleanup)
function fill(first, second = first) {
  fireEvent.change(screen.getByLabelText('새 비밀번호'), { target: { value: first } })
  fireEvent.change(screen.getByLabelText('새 비밀번호 확인'), { target: { value: second } })
}
test('short and mismatched passwords never reach the server', () => {
  render(<ResetPassword onDone={vi.fn()} />)
  fill('short')
  fireEvent.click(screen.getByRole('button'))
  expect(screen.getByText('비밀번호는 8자 이상으로 해주세요.')).toBeTruthy()
  fill('test-only-password', 'different-password')
  fireEvent.click(screen.getByRole('button'))
  expect(screen.getByText('비밀번호가 서로 달라요.')).toBeTruthy()
  expect(state.updateUser).not.toHaveBeenCalled()
})
test('click and enter while saving produce only one password update', async () => {
  let resolve
  state.updateUser.mockReturnValue(new Promise(r => { resolve = r }))
  const done = vi.fn()
  render(<ResetPassword onDone={done} />)
  fill('test-only-password')
  fireEvent.click(screen.getByRole('button'))
  fireEvent.keyDown(screen.getByLabelText('새 비밀번호 확인'), { key: 'Enter' })
  expect(state.updateUser).toHaveBeenCalledTimes(1)
  expect(done).not.toHaveBeenCalled()
  await act(async () => resolve({ error: null }))
  expect(done).toHaveBeenCalledTimes(1)
})
test('expired session or network failure preserves retry and never reports success', async () => {
  state.updateUser.mockRejectedValueOnce(new Error('session expired')).mockResolvedValueOnce({ error: null })
  const done = vi.fn()
  render(<ResetPassword onDone={done} />)
  fill('test-only-password')
  await act(async () => fireEvent.click(screen.getByRole('button')))
  expect(screen.getByText('비밀번호를 변경하지 못했어요. 복구 링크와 연결 상태를 확인해주세요.')).toBeTruthy()
  expect(done).not.toHaveBeenCalled()
  expect(screen.getByRole('button').disabled).toBe(false)
  await act(async () => fireEvent.click(screen.getByRole('button')))
  expect(done).toHaveBeenCalledTimes(1)
})
