import { useCallback, useEffect, useRef, useState } from 'react'

// useState처럼 쓰되, 값이 바뀔 때마다 브라우저 히스토리에 한 단계씩 쌓아둬서
// 폰의 뒤로가기(제스처/버튼)로 화면 안의 이전 단계로 돌아올 수 있게 해주는 훅.
// (화면 안에 있는 '뒤로' 버튼과는 별개로, 기기 자체의 뒤로가기가 그냥 앱을 나가버리는 문제를 해결함)
export function useBackableStep(initialValue, key = 'zr-step') {
  const [value, setValue] = useState(initialValue)
  const current = useRef(value)

  useEffect(() => {
    window.history.replaceState({ ...window.history.state, [key]: current.current }, '')
    const onPopState = (e) => {
      current.current = e.state?.[key] ?? initialValue
      setValue(current.current)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [key, initialValue])

  const setStep = useCallback(
    (next) => {
      const resolved = typeof next === 'function' ? next(current.current) : next
      if (resolved === current.current) return
      window.history.pushState({ ...window.history.state, [key]: resolved }, '')
      current.current = resolved
      setValue(resolved)
    },
    [key]
  )

  return [value, setStep]
}
