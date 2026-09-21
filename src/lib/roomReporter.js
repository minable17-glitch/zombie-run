// Serialize updates so an old in-flight "alive" update cannot overwrite a finish.
export function createRoomReporter(send, onSuccess, onError) {
  let pending = null
  let running = false
  let terminal = false
  let disposed = false
  async function flush() {
    if (running || disposed || !pending) return
    running = true
    const snapshot = pending
    pending = null
    try {
      await send(snapshot)
      if (!disposed) onSuccess(snapshot)
    } catch {
      if (!pending) pending = snapshot
      if (!disposed) onError(snapshot)
      running = false
      return // Retry on the next poll, not in a tight loop.
    }
    running = false
    if (pending && !disposed) void flush()
  }
  return {
    submit(snapshot) {
      if (disposed || terminal) return
      terminal = snapshot.status !== 'alive'
      pending = snapshot
      void flush()
    },
    retry: flush,
    dispose() { disposed = true; pending = null },
  }
}
