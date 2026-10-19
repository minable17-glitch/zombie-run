import { useState } from 'react'

// 소수점 입력 중간 상태("0.", 빈 문자열 등)를 그대로 보여주면서, 계산에 쓰는 값은 항상
// 유효 범위 안의 숫자로 따로 뽑아내는 훅. 입력칸에 매 타이핑마다 clamp된 값을 즉시 되돌려
// 쓰면("0."을 입력하는 중간에 0으로 파싱돼 최솟값으로 튕기는 식) 소수점을 아예 입력할 수
// 없게 막히는 문제가 생겨서, 보여주는 텍스트와 실제 숫자값을 분리했다.
export function useNumericText(initialValue, min, max) {
  const [text, setText] = useState(String(initialValue))
  const parsed = parseFloat(text)
  const value = Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : min
  const setValue = (next) => setText(String(next))
  return [value, text, setText, setValue]
}
