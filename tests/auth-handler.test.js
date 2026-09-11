// @vitest-environment node
import { test, expect, vi } from 'vitest'
import { makeAuthHandler } from '../supabase/functions/zombie-auth/handler.js'
const redirectTo='https://example.test/game/'
function setup(profile={email:'private@example.test'}, authResult={data:{session:{access_token:'access',refresh_token:'refresh'}},error:null}) {
 const auth={signInWithPassword:vi.fn().mockResolvedValue(authResult),
 resetPasswordForEmail:vi.fn().mockResolvedValue({}),signInWithOtp:vi.fn().mockResolvedValue({})}
 const query={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockResolvedValue({data:profile})}
 const rateLimit=vi.fn().mockResolvedValue(true)
 return {auth,rateLimit,handle:makeAuthHandler({admin:{from:()=>query},createAuthClient:()=>({auth}),redirects:[redirectTo],rateLimit})}
}
const request=(body)=>new Request('https://api.test',{method:'POST',body:JSON.stringify({redirectTo,...body}),headers:{origin:'https://example.test'}})
test('login sends only user tokens after password verification',async()=>{
 const {handle,auth}=setup()
 const response=await handle(request({action:'login',username:'Runner',password:'password'}))
 expect(await response.json()).toEqual({session:{access_token:'access',refresh_token:'refresh'}})
 expect(auth.signInWithPassword).toHaveBeenCalledWith({email:'private@example.test',password:'password'})
})
test('unknown account and wrong password use the same public error',async()=>{
 const a=await setup(null).handle(request({action:'login',username:'runner',password:'wrong'}))
 const b=await setup(undefined,{data:{},error:{message:'bad'}}).handle(request({action:'login',username:'runner',password:'wrong'}))
 expect(a.status).toBe(401); expect(await a.json()).toEqual(await b.json())
})
test('recovery does not disclose registration or return email',async()=>{
 const yes=setup(), no=setup(null)
 const a=await yes.handle(request({action:'recover',email:'private@example.test'}))
 const b=await no.handle(request({action:'recover',email:'unknown@example.test'}))
 expect(await a.json()).toEqual(await b.json())
 expect(no.auth.signInWithOtp).not.toHaveBeenCalled()
 expect(yes.auth.signInWithOtp).toHaveBeenCalledWith({email:'private@example.test',options:{shouldCreateUser:false,emailRedirectTo:redirectTo+'?account=1'}})
})
test('reject redirects, excessive requests, oversized input and limiter failure',async()=>{
 const {handle,rateLimit,auth}=setup()
 expect((await handle(request({action:'reset',username:'runner',redirectTo:'https://evil.test/'}))).status).toBe(400)
 rateLimit.mockResolvedValue(false)
 expect((await handle(request({action:'reset',username:'runner'}))).status).toBe(429)
 rateLimit.mockRejectedValue(new Error('offline'))
 expect((await handle(request({action:'reset',username:'runner'}))).status).toBe(503)
 expect(auth.resetPasswordForEmail).not.toHaveBeenCalled()
 expect((await handle(request({action:'login',username:'runner',password:'x'.repeat(5000)}))).status).toBe(413)
})

