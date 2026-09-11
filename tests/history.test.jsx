import React from 'react'
import { test, expect, afterEach } from 'vitest'
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
import { useBackableStep } from '../src/lib/useBackableStep.js'
afterEach(cleanup)
test('back and forward restore destinations once under StrictMode',async()=>{
 window.history.replaceState({other:'preserved'},'','/')
 const {result}=renderHook(()=>useBackableStep('game','mode'),{wrapper:({children})=><React.StrictMode>{children}</React.StrictMode>})
 const before=window.history.length
 act(()=>result.current[1]('room'))
 act(()=>result.current[1]('admin'))
 expect(window.history.length-before).toBe(2)
 expect(window.history.state).toMatchObject({mode:'admin',other:'preserved'})
 act(()=>window.history.back())
 await waitFor(()=>expect(result.current[0]).toBe('room'))
 act(()=>window.history.back())
 await waitFor(()=>expect(result.current[0]).toBe('game'))
 act(()=>window.history.forward())
 await waitFor(()=>expect(result.current[0]).toBe('room'))
})

