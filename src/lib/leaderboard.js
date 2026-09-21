const safeInt = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0

// Rank the last server-confirmed snapshot; do not extrapolate a disconnected runner.
export function rankPlayers(players = []) {
  const sorted = players.map(p => ({ ...p, elapsed_sec: safeInt(p.elapsed_sec), distance_m: safeInt(Math.round(Number(p.distance_m))) }))
    .sort((a, b) => b.elapsed_sec - a.elapsed_sec || b.distance_m - a.distance_m || String(a.id).localeCompare(String(b.id)))
  let rank = 0
  return sorted.map((p, i) => {
    const prev = sorted[i - 1]
    if (!prev || prev.elapsed_sec !== p.elapsed_sec || prev.distance_m !== p.distance_m) rank = i + 1
    return { ...p, rank }
  })
}
