import { test,expect } from 'vitest'
import { patrolReinforcement,usableChasePath,projectRoute } from '../src/lib/routePressure.js'
import { makeInitialGame,applyStartSetup,advanceGame } from '../src/lib/gameEngine.js'
import { haversineDistance } from '../src/lib/geo.js'
const route=[{lat:37,lon:127},{lat:37.01,lon:127}]
const map={id:'long',routes:[route],center:route[0],radius:1500}
const distance=(a,b)=>haversineDistance(a.lat,a.lon,b.lat,b.lon)
function game(){
 const g={...makeInitialGame(),status:'playing',playerPos:{lat:37.005,lon:127},headingDeg:0}
 applyStartSetup(g,g.playerPos,{paceMps:2,forcedMap:map})
 return g
}
test('stationary runner receives recurring rear patrols on long segments with safe spacing and a cap',()=>{
 const g=game()
 const z=patrolReinforcement(g,1)
 expect(z.lat).toBeLessThan(g.playerPos.lat)
 expect(z.lon).toBe(127)
 expect(distance(z,g.playerPos)).toBeCloseTo(90,1)
 expect(z.patrolIndex).toBe(1)
 g.elapsedSec=59
 advanceGame(g,1,60000)
 expect(g.zombies).toHaveLength(2)
 expect(g.nextWaveSec).toBe(105)
 g.elapsedSec=104
 advanceGame(g,1,105000)
 expect(g.zombies).toHaveLength(3)
 for(let i=0;i<10;i++) {g.elapsedSec=g.nextWaveSec-1;advanceGame(g,1,150000+i*45000)}
 expect(g.zombies.length).toBeLessThanOrEqual(4)
 expect(g.zombies.every(z=>z.patrolRoute===route && z.lon===127)).toBe(true)
})
test('reverse heading spawns on the opposite side; short routes never spawn on top of runner',()=>{
 const g=game();g.headingDeg=180
 const z=patrolReinforcement(g,1)
 expect(z.lat).toBeGreaterThan(g.playerPos.lat)
 expect(z.patrolDir).toBe(-1)
 g.presetMap={...map,routes:[[{lat:37.005,lon:127},{lat:37.0051,lon:127}]]}
 expect(patrolReinforcement(g,2)).toBeNull()
})
test('road route ending at a distant snapped street is rejected; nearby endpoints connect to runner',()=>{
 const z={lat:37,lon:127},p={lat:37.005,lon:127}
 expect(usableChasePath([{...z},{lat:37.002,lon:127}],z,p)).toBeNull()
 const path=usableChasePath([{...z},{lat:37.0049,lon:127}],z,p)
 expect(path.at(-1)).toEqual(p)
 expect(projectRoute(route,p).point.lat).toBeCloseTo(p.lat)
})
test('stale road routes stop pulling zombies away from a player in unmapped areas',()=>{
 const g={...makeInitialGame(),status:'playing',playerPos:{lat:37.001,lon:127},nextWaveSec:Infinity}
 const z={id:'z',lat:37,lon:127,speed:2,path:[{lat:37,lon:127},{lat:36.99,lon:127}],pathFetchedFor:{lat:36.99,lon:127},lastRouteAt:0}
 g.zombies=[z]
 advanceGame(g,1,21000)
 expect(distance(g.zombies[0],g.playerPos)).toBeLessThan(distance(z,g.playerPos))
 expect(g.zombies[0].path).toBeNull()
})
