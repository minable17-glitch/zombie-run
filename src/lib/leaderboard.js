const safeInt = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0
const safeIntOrNull = value => value == null ? null : safeInt(value)

// Rank the last server-confirmed snapshot; do not extrapolate a disconnected runner.
// goalM>0 (거리 목표런): whoever reached the goal fastest ranks first; everyone who
// hasn't reached it yet is ranked after, by how far they've gotten.
export function rankPlayers(players = [], goalM = 0) {
  const norm = players.map(p => ({
    ...p, elapsed_sec: safeInt(p.elapsed_sec), distance_m: safeInt(Math.round(Number(p.distance_m))),
    goal_reached_sec: safeIntOrNull(p.goal_reached_sec),
  }))
  const sorted = goalM > 0
    ? norm.sort((a, b) => {
        const aReached = a.goal_reached_sec != null, bReached = b.goal_reached_sec != null
        if (aReached !== bReached) return aReached ? -1 : 1
        return (aReached ? a.goal_reached_sec - b.goal_reached_sec : b.distance_m - a.distance_m) ||
          String(a.id).localeCompare(String(b.id))
      })
    : norm.sort((a, b) => b.elapsed_sec - a.elapsed_sec || b.distance_m - a.distance_m || String(a.id).localeCompare(String(b.id)))
  let rank = 0
  return sorted.map((p, i) => {
    const prev = sorted[i - 1]
    const tie = prev && (goalM > 0
      ? prev.goal_reached_sec === p.goal_reached_sec && (p.goal_reached_sec != null || prev.distance_m === p.distance_m)
      : prev.elapsed_sec === p.elapsed_sec && prev.distance_m === p.distance_m)
    if (!tie) rank = i + 1
    return { ...p, rank }
  })
}
