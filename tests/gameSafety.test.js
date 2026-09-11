import { test, expect } from 'vitest'
import { readFix, measureMovement, validZombieMap } from '../src/lib/gameSafety.js'
test('reject stale or inaccurate GPS; accumulate plausible running movement',()=>{
 const now=Date.now()
 const position={timestamp:now,coords:{latitude:37,longitude:127,accuracy:5}}
 const from=readFix(position,now)
 expect(from).toBeTruthy()
 expect(readFix({...position,timestamp:now-20000},now)).toBeNull()
 expect(readFix({...position,coords:{...position.coords,accuracy:80}},now)).toBeNull()
 expect(measureMovement(from,{...from,lat:37.00009,t:now+5000})).toBeGreaterThan(9)
 expect(measureMovement(from,{...from,lat:38,t:now+1000})).toBe(0)
 expect(measureMovement(from,{...from,lat:37.000001,t:now+1000})).toBe(0)
})
test('empty map is intentional, empty patrol route is invalid',()=>{
 const row={center_lat:37,center_lon:127,radius_m:400,routes:[]}
 expect(validZombieMap(row)).toBe(true)
 expect(validZombieMap({...row,routes:[[]]})).toBe(false)
})

