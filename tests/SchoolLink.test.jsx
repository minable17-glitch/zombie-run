import React from 'react'
import { test, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
vi.mock('../src/lib/schoolLinkApi.js', () => ({ linkSchoolAccount: vi.fn() }))
import * as api from '../src/lib/schoolLinkApi.js'
import SchoolLink from '../src/SchoolLink.jsx'
const runner = { id: 'runner-id', nickname: '달리미' }
beforeEach(() => vi.resetAllMocks())
afterEach(cleanup)

test('linking sends the runner identity and shows the confirmed student and class', async () => {
  api.linkSchoolAccount.mockResolvedValue({ ok: true, studentName: '홍길동', className: '3반' })
  render(<SchoolLink runner={runner} />)
  fireEvent.click(screen.getByText('학교 행사와 연동하기'))
  fireEvent.change(screen.getByLabelText('학번'), { target: { value: '30512' } })
  fireEvent.change(screen.getByLabelText('이름'), { target: { value: '홍길동' } })
  fireEvent.change(screen.getByLabelText('매 1런 비밀번호'), { target: { value: '1234' } })
  fireEvent.click(screen.getByText('연동하기'))
  expect(await screen.findByText('3반 홍길동 학생과 연동됐어요')).toBeTruthy()
  expect(api.linkSchoolAccount).toHaveBeenCalledExactlyOnceWith({
    studentNumber: '30512', name: '홍길동', pin: '1234',
    zombieRunnerId: 'runner-id', zombieNickname: '달리미',
  })
})

test('an account already linked to someone else shows the conflict message instead of retrying', async () => {
  api.linkSchoolAccount.mockRejectedValue(Error('이 계정은 이미 다른 학생과 연결돼 있어요.'))
  render(<SchoolLink runner={runner} />)
  fireEvent.click(screen.getByText('학교 행사와 연동하기'))
  fireEvent.change(screen.getByLabelText('학번'), { target: { value: '30512' } })
  fireEvent.change(screen.getByLabelText('이름'), { target: { value: '홍길동' } })
  fireEvent.change(screen.getByLabelText('매 1런 비밀번호'), { target: { value: '1234' } })
  fireEvent.click(screen.getByText('연동하기'))
  expect(await screen.findByText('이 계정은 이미 다른 학생과 연결돼 있어요.')).toBeTruthy()
  await waitFor(() => expect(screen.getByText('연동하기').disabled).toBe(false))
})
