import React from 'react'
import { test, expect, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useNumericText } from '../src/lib/useNumericText.js'

afterEach(() => cleanup())

test('typing a decimal is never blocked by an intermediate value parsing to 0', () => {
  const { result } = renderHook(() => useNumericText(0.3, 0.1, 50))
  act(() => result.current[2]('0'))
  expect(result.current[1]).toBe('0') // the displayed text keeps exactly what was typed
  expect(result.current[0]).toBe(0.1) // the derived value falls back to the minimum, not NaN/0
  act(() => result.current[2]('0.'))
  expect(result.current[1]).toBe('0.') // still not reset or blocked mid-decimal
  act(() => result.current[2]('0.1'))
  expect(result.current[1]).toBe('0.1')
  expect(result.current[0]).toBe(0.1)
  act(() => result.current[2]('0.15'))
  expect(result.current[1]).toBe('0.15')
  expect(result.current[0]).toBe(0.15) // finally parses and clamps correctly once complete
})

test('clamps the derived value to the given range without touching the displayed text', () => {
  const { result } = renderHook(() => useNumericText(1, 0.1, 5))
  act(() => result.current[2]('999'))
  expect(result.current[1]).toBe('999')
  expect(result.current[0]).toBe(5)
  act(() => result.current[2](''))
  expect(result.current[1]).toBe('')
  expect(result.current[0]).toBe(0.1)
})

test('setValue (preset buttons) overwrites the displayed text with the new number', () => {
  const { result } = renderHook(() => useNumericText(1, 0.1, 50))
  act(() => result.current[3](3))
  expect(result.current[1]).toBe('3')
  expect(result.current[0]).toBe(3)
})
