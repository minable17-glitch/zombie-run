import { haversineDistance, bearingTo, moveToward } from './geo.js'

const distance = (a,b) => haversineDistance(a.lat,a.lon,b.lat,b.lon)

// Project onto segments, not just vertices, so long hand-drawn sections work too.
export function projectRoute(route, position) {
  let best = null, offset = 0
  for (let i=0; i<route.length-1; i++) {
    const a=route[i], b=route[i+1], length=distance(a,b)
    if (length < 0.01) continue
    const scale=Math.cos(position.lat*Math.PI/180)
    const dx=(b.lon-a.lon)*scale, dy=b.lat-a.lat
    const t=Math.max(0,Math.min(1,((position.lon-a.lon)*scale*dx+(position.lat-a.lat)*dy)/(dx*dx+dy*dy)))
    const point={lat:a.lat+(b.lat-a.lat)*t,lon:a.lon+(b.lon-a.lon)*t}
    const gap=distance(point,position)
    if (!best || gap<best.gap) best={point,gap,along:offset+length*t,index:i}
    offset+=length
  }
  return best && {...best,total:offset}
}

export function patrolReinforcement(game, now) {
  let selected=null
  for (const route of game.presetMap.routes) {
    const projection=projectRoute(route,game.playerPos)
    if (projection && (!selected || projection.gap<selected.projection.gap)) selected={route,projection}
  }
  if (!selected) return null
  const {route,projection}=selected
  // Preserve the authored-route rule. Do not materialize enemies far off the course.
  if (projection.gap>70) return null
  const forward=bearingTo(route[projection.index].lat,route[projection.index].lon,route[projection.index+1].lat,route[projection.index+1].lon)
  let direction=game.headingDeg==null || Math.cos((game.headingDeg-forward)*Math.PI/180)>=0 ? 1 : -1
  if ((direction===1 ? projection.along : projection.total-projection.along)<40) direction*=-1
  const along=Math.max(0,Math.min(projection.total,projection.along-direction*90))
  let remaining=along
  for (let i=0;i<route.length-1;i++) {
    const length=distance(route[i],route[i+1])
    if (remaining>length) { remaining-=length; continue }
    const point=moveToward(route[i].lat,route[i].lon,route[i+1].lat,route[i+1].lon,remaining)
    if (distance(point,game.playerPos)<35) return null
    return {id:`reinforcement_${now}`, ...point, speed:game.targetPaceMps,
      patrolRoute:route,patrolIndex:direction===1 ? i+1 : i,patrolDir:direction,
      state:'patrol',path:null,pathFetchedFor:null,lastRouteAt:0,routing:false}
  }
  return null
}

// Navigation data may stop at the nearest public street. Avoid reattaching an
// unreachable/stale road endpoint on every refresh when the runner is inside a complex.
export function usableChasePath(path, zombie, target) {
  if (!path || path.length<2) return null
  if (distance(path[0],zombie)>80 || distance(path[path.length-1],target)>40) return null
  const projection=projectRoute(path,zombie)
  if (!projection || projection.gap>80) return null
  return [{lat:zombie.lat,lon:zombie.lon},projection.point,...path.slice(projection.index+1),{lat:target.lat,lon:target.lon}]
}
