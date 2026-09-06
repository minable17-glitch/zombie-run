import { useCallback, useEffect, useRef, useState } from 'react'

let seq = 0

// useState처럼 쓰되, 값이 바뀔 때마다 브라우저 히스토리에 한 단계씩 쌓아둬서
// 폰의 뒤로가기(제스처/버튼)로 화면 안의 이전 단계로 돌아올 수 있게 해주는 훅.
// (화면 안에 있는 '뒤로' 버튼과는 별개로, 기기 자체의 뒤로가기가 그냥 앱을 나가버리는 문제를 해결함)
export function useBackableStep(initialValue) {
  const [value, setValue] = useState(initialValue)
  const keyRef = useRef(null)
  if (keyRef.current === null) keyRef.current = `zrstep${seq++}`
  const key = keyRef.current
  const skipNextPush = useRef(false)

  useEffect(() => {
    const onPopState = (e) => {
      if (e.state && Object.prototype.hasOwnProperty.call(e.state, key)) {
        skipNextPush.current = true
        setValue(e.state[key])
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [key])

  const setStep = useCallback(
    (next) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next
        if (resolved !== prev && !skipNextPush.current) {
          window.history.pushState({ [key]: prev }, '')
        }
        skipNextPush.current = false
        return resolved
      })
    },
    [key]
  )

  return [value, setStep]
}
