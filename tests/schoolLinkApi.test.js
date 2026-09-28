import { test, expect, vi, afterEach } from 'vitest'
import { linkSchoolAccount } from '../src/lib/schoolLinkApi.js'

afterEach(() => vi.restoreAllMocks())

const args = { studentNumber: '30512', name: '홍길동', pin: '1234', zombieRunnerId: 'runner-id', zombieNickname: '달리미' }

test('posts the runner identity alongside the student credentials and returns the confirmation', async () => {
  global.fetch = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ ok: true, studentName: '홍길동', className: '3반' }) })
  const data = await linkSchoolAccount(args)
  expect(data).toEqual({ ok: true, studentName: '홍길동', className: '3반' })
  expect(fetch).toHaveBeenCalledExactlyOnceWith('https://running-journal-wine.vercel.app/api/zombie-run/link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
})

test('a 409 conflict always reports that the account belongs to another student', async () => {
  global.fetch = vi.fn().mockResolvedValue({ status: 409, json: async () => ({ ok: false, error: 'conflict' }) })
  await expect(linkSchoolAccount(args)).rejects.toThrow('이 계정은 이미 다른 학생과 연결돼 있어요.')
})

test('a rejected match surfaces the server error message', async () => {
  global.fetch = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ ok: false, error: '학번과 이름을 확인해주세요.' }) })
  await expect(linkSchoolAccount(args)).rejects.toThrow('학번과 이름을 확인해주세요.')
})

test('a network failure gives a retry-friendly message instead of throwing raw fetch errors', async () => {
  global.fetch = vi.fn().mockRejectedValue(Error('network down'))
  await expect(linkSchoolAccount(args)).rejects.toThrow('매 1런 서버에 연결하지 못했어요. 네트워크를 확인하고 다시 시도해주세요.')
})
