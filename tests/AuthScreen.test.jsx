import React from 'react'
import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
vi.mock('../src/lib/supabaseClient.js',()=>({supabase:{auth:{signUp:vi.fn()}}}))
vi.mock('../src/lib/authHelpers.js',()=>({
 authRequest:vi.fn(),loginWithUsername:vi.fn(),normalizeUsername:s=>s.trim().toLowerCase(),siteUrl:()=> 'https://example.test/',
}))
import {supabase} from '../src/lib/supabaseClient.js'
import {loginWithUsername} from '../src/lib/authHelpers.js'
import AuthScreen from '../src/AuthScreen.jsx'
afterEach(cleanup)
test('confirmation message survives switching to login after signup',async()=>{
 supabase.auth.signUp.mockResolvedValue({data:{session:null}})
 render(<AuthScreen onBack={()=>{}}/>)
 fireEvent.click(screen.getByRole('button',{name:'계정 만들기'}))
 fireEvent.change(screen.getByLabelText('아이디'),{target:{value:'Runner'}})
 fireEvent.change(screen.getByLabelText('이메일'),{target:{value:'runner@example.test'}})
 fireEvent.change(screen.getByLabelText('비밀번호'),{target:{value:'password123'}})
 await act(async()=>fireEvent.submit(document.querySelector('form')))
 expect(screen.getByRole('status').textContent).toContain('인증 메일')
 expect(supabase.auth.signUp.mock.calls[0][0].options.data).toEqual({username:'runner',app:'zombie-run'})
})
test('enter/double submit cannot issue two requests',async()=>{
 let finish
 loginWithUsername.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
 render(<AuthScreen onBack={()=>{}}/>)
 fireEvent.change(screen.getByLabelText('아이디'),{target:{value:'runner'}})
 fireEvent.change(screen.getByLabelText('비밀번호'),{target:{value:'password'}})
 fireEvent.submit(document.querySelector('form')); fireEvent.submit(document.querySelector('form'))
 expect(loginWithUsername).toHaveBeenCalledTimes(1)
 await act(async()=>finish())
})

