import { test, expect, vi } from 'vitest'
import { createScreenWake } from '../src/lib/screenWake.js'
const flush = async () => { await Promise.resolve(); await Promise.resolve() }
function setup(request) {
 const doc = new EventTarget(); doc.hidden = false
 const status = vi.fn()
 const controller = createScreenWake(status, { wakeLock: { request } }, doc)
 return { doc, status, controller }
}
function lock() { const s = new EventTarget(); s.release = vi.fn(async () => {}); return s }
test('screen wake lock releases when hidden, reacquires on return and stops after disposal', async () => {
 const a = lock(), b = lock(), request = vi.fn().mockResolvedValueOnce(a).mockResolvedValueOnce(b)
 const { doc, controller, status } = setup(request)
 controller.setEnabled(true); await flush()
 expect(status).toHaveBeenLastCalledWith('on')
 doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'))
 expect(a.release).toHaveBeenCalledOnce()
 doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange')); await flush()
 expect(request).toHaveBeenCalledTimes(2)
 controller.dispose(); expect(b.release).toHaveBeenCalledOnce()
 doc.dispatchEvent(new Event('visibilitychange')); expect(request).toHaveBeenCalledTimes(2)
})
test('late lock acquisition after cancellation is immediately released', async () => {
 let resolve; const request = vi.fn(() => new Promise(r => { resolve = r }))
 const { controller, status } = setup(request); const s = lock()
 controller.setEnabled(true); controller.setEnabled(false); resolve(s); await flush()
 expect(s.release).toHaveBeenCalledOnce(); expect(status).toHaveBeenLastCalledWith('off')
 controller.dispose()
})
test('rejected and unsupported wake lock requests are reported honestly', async () => {
 const { controller, status } = setup(vi.fn().mockRejectedValue(new Error('denied')))
 controller.setEnabled(true); await flush(); expect(status).toHaveBeenLastCalledWith('unavailable'); controller.dispose()
 const unsupported = createScreenWake(status, {}, new EventTarget())
 unsupported.setEnabled(true); expect(status).toHaveBeenLastCalledWith('unsupported'); unsupported.dispose()
})
