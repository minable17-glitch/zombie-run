// @vitest-environment node
import { beforeAll, afterAll, test, expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

const migration = ['20260909140000_zombie_run_security.sql', '20260910010000_room_expiration.sql', '20260911030000_legacy_profile_lookup.sql', '20260916010000_map_boundary.sql', '20260921010000_room_survival_rank.sql', '20260922010000_personal_survival.sql', '20260922020000_finished_rooms.sql', '20260923010000_solo_maps.sql', '20260923020000_six_digit_codes.sql', '20260923021000_code_attempt_guard.sql']
  .map(name => readFileSync('supabase/migrations/' + name, 'utf8').replace(/^\uFEFF/, '').trim()).join('\n\n')
const ids = {
  host: '00000000-0000-4000-8000-000000000001',
  member: '00000000-0000-4000-8000-000000000002',
  stranger: '00000000-0000-4000-8000-000000000003',
  account: '00000000-0000-4000-8000-000000000004',
}
let db

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users (
      id uuid primary key, email text, raw_user_meta_data jsonb default '{}',
      is_anonymous boolean default false
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
  `)
  await db.exec(migration)
  for (const id of [ids.host, ids.member, ids.stranger]) {
    await db.query('insert into auth.users(id,is_anonymous) values($1,true)', [id])
  }
}, 60000)
afterAll(async () => { await db?.close() })

function asUser(id, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec('set local role authenticated')
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [id])
    return tx.query(sql, params)
  })
}

test('the actual SQL executes twice and guest accounts do not create profiles', async () => {
  await db.exec(migration)
  expect((await db.query('select count(*)::int n from profiles')).rows[0].n).toBe(0)
  expect(readFileSync('supabase/schema.sql', 'utf8').replace(/^\uFEFF/, '').trim()).toBe(migration)
})

test('legacy profiles remain usable without username metadata and keep their stored username', async () => {
  const id = '00000000-0000-4000-8000-000000000099'
  await db.query("insert into auth.users(id,email) values($1,'legacy@example.test')", [id])
  await db.query("insert into profiles(id,username,email) values($1,'legacy_runner','old@example.test')", [id])
  await asUser(id, 'select zr_ensure_profile()')
  expect((await asUser(id, 'select username,email from profiles')).rows).toEqual([
    { username: 'legacy_runner', email: 'legacy@example.test' },
  ])
  await expect(asUser(ids.host, 'select zr_ensure_profile()')).rejects.toThrow()
})

test('signup creates a normalized profile atomically and rejects duplicate names', async () => {
  await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',
    [ids.account, 'Runner@example.test', { username: 'Runner', app: 'zombie-run' }])
  expect((await asUser(ids.account, 'select username,email from profiles')).rows)
    .toEqual([{ username: 'runner', email: 'runner@example.test' }])
  await expect(db.query("insert into auth.users(id,email,raw_user_meta_data) values(gen_random_uuid(),'duplicate@example.test',$1)",
    [{ username: 'RUNNER', app: 'zombie-run' }])).rejects.toThrow()
  expect((await db.query("select count(*)::int n from auth.users where email='duplicate@example.test'")).rows[0].n).toBe(0)
})

test('anonymous callers cannot read profiles and users cannot edit email mappings', async () => {
  await expect(db.transaction(async tx => {
    await tx.exec('set local role anon')
    return tx.query('select email from profiles')
  })).rejects.toThrow(/permission denied/)
  expect((await asUser(ids.stranger, 'select * from profiles')).rows).toHaveLength(0)
  await expect(asUser(ids.account, "update profiles set email='false@example.test'"))
    .rejects.toThrow(/permission denied/)
})

test('only hosts start rooms, only members read them, repeated join preserves player identity', async () => {
  const made = (await asUser(ids.host, "select zr_create_room('Host',$1) result", [{ paceIdx: 1 }])).rows[0].result
  const room = made.room.id
  const joined = (await asUser(ids.member, "select zr_join_room($1,'Member') result", [made.room.code])).rows[0].result
  const again = (await asUser(ids.member, "select zr_join_room($1,'Member') result", [made.room.code])).rows[0].result
  expect(again.player.id).toBe(joined.player.id)
  await expect(asUser(ids.stranger, 'select zr_read_room($1)', [room])).rejects.toThrow()
  await expect(asUser(ids.member, 'select zr_start_room($1)', [room])).rejects.toThrow()
  await asUser(ids.host, 'select zr_start_room($1)', [room])
  await expect(asUser(ids.stranger, "select zr_join_room($1,'Late')", [made.room.code])).rejects.toThrow()
  await asUser(ids.member, "select zr_update_stat($1,0,4,'finished')", [room])
  await asUser(ids.member, "select zr_update_stat($1,0,6,'alive')", [room])
  const snapshot = (await asUser(ids.host, 'select zr_read_room($1) result', [room])).rows[0].result
  expect(snapshot.players.find(p => p.id === joined.player.id)).toMatchObject({ health: 4, status: 'finished' })
  expect(snapshot.players.find(p => p.id === made.player.id)).toMatchObject({ health: 6, status: 'alive' })
  expect(snapshot.room).not.toHaveProperty('host_user_id')
  expect(snapshot.players[0]).not.toHaveProperty('auth_user_id')
  await expect(asUser(ids.stranger, "select zr_update_stat($1,0,6,'alive')", [room])).rejects.toThrow()
  await expect(asUser(ids.member, "select zr_update_stat($1,'NaN',6,'alive')", [room])).rejects.toThrow()
  await expect(asUser(ids.member, 'update room_players set health=100')).rejects.toThrow(/permission denied/)
})

test('completed rooms can be closed by their owner while active rooms and final records survive', async () => {
 const made=(await asUser(ids.host,"select zr_create_room('Cleanup',$1) result",[{}])).rows[0].result
 await asUser(ids.host,'select zr_start_room($1)',[made.room.id])
 await asUser(ids.host,'select zr_cleanup_finished_rooms()')
 expect((await db.query('select status from game_rooms where id=$1',[made.room.id])).rows[0].status).toBe('started')
 await asUser(ids.host,"select zr_update_stat_v2($1,0,6,'finished',0)",[made.room.id])
 await asUser(ids.stranger,'select zr_cleanup_finished_rooms()')
 expect((await db.query('select status from game_rooms where id=$1',[made.room.id])).rows[0].status).toBe('started')
 await asUser(ids.host,'select zr_cleanup_finished_rooms()')
 expect((await db.query('select status from game_rooms where id=$1',[made.room.id])).rows[0].status).toBe('closed')
 expect((await db.query('select status from room_players where room_id=$1',[made.room.id])).rows[0].status).toBe('finished')
})

test('host leaving closes lobby; invalid config and malformed map routes are rejected', async () => {
  await expect(asUser(ids.host, "select zr_create_room('Host',$1)", [{ paceIdx: 99 }])).rejects.toThrow()
  const made = (await asUser(ids.host, "select zr_create_room('Host',$1) result", [{}])).rows[0].result
  await asUser(ids.host, 'select zr_leave_room($1)', [made.room.id])
  await expect(asUser(ids.member, "select zr_join_room($1,'Member')", [made.room.code])).rejects.toThrow()
  await expect(db.query("insert into zombie_maps(name,center_lat,center_lon,radius_m,routes) values('Bad',37,127,400,'[[]]')"))
    .rejects.toThrow()
})

test('expired rooms close on creation without deleting records and cleanup is service-only', async () => {
  const old = (await asUser(ids.stranger, "select zr_create_room('Old',$1) result", [{}])).rows[0].result
  await asUser(ids.stranger, 'select zr_start_room($1)', [old.room.id])
  await db.query("update game_rooms set created_at=now()-interval '25 hours' where id=$1", [old.room.id])
  const fresh = (await asUser(ids.member, "select zr_create_room('Fresh',$1) result", [{}])).rows[0].result
  expect((await db.query('select status from game_rooms where id=$1', [old.room.id])).rows[0].status).toBe('closed')
  expect((await db.query('select id from room_players where id=$1', [old.player.id])).rows).toHaveLength(1)
  expect((await db.query('select status from game_rooms where id=$1', [fresh.room.id])).rows[0].status).toBe('waiting')
  await expect(asUser(ids.member, 'select zr_expire_rooms()')).rejects.toThrow(/permission denied/)
  await db.query("update game_rooms set created_at=now()-interval '25 hours' where id=$1", [fresh.room.id])
  await db.transaction(async tx => {
    await tx.exec('set local role service_role')
    expect((await tx.query('select zr_expire_rooms() n')).rows[0].n).toBe(1)
    expect((await tx.query('select zr_expire_rooms() n')).rows[0].n).toBe(0)
  })
})

test('the rate limiter denies excess requests and cannot be reset by clients', async () => {
  const key = 'a'.repeat(64)
  expect((await db.query('select zr_auth_limit($1,1) ok', [key])).rows[0].ok).toBe(true)
  expect((await db.query('select zr_auth_limit($1,1) ok', [key])).rows[0].ok).toBe(false)
  await expect(asUser(ids.member, 'select zr_auth_limit($1,1)', [key])).rejects.toThrow(/permission denied/)
})

test('known legacy trigger is replaced without breaking guest or unrelated app signups', async () => {
  await db.exec(`
    create function public.handle_new_user() returns trigger language plpgsql security definer as $$
    begin
      insert into public.profiles(id,username,email)
      values(new.id,lower(new.raw_user_meta_data->>'username'),new.email) on conflict(id) do nothing;
      return new;
    end $$;
    create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
  `)
  await db.exec(migration)
  await db.query('insert into auth.users(id,is_anonymous) values(gen_random_uuid(),true)')
  await db.query("insert into auth.users(id,email) values(gen_random_uuid(),'shared-app@example.test')")
  expect((await db.query("select count(*)::int n from pg_trigger where tgname='on_auth_user_created'")).rows[0].n).toBe(0)
  expect((await db.query("select count(*)::int n from profiles where email='shared-app@example.test'")).rows[0].n).toBe(0)
})

test('confirmed email updates synchronize the owning profile', async () => {
  await db.query("update auth.users set email='Updated@example.test' where id=$1", [ids.account])
  expect((await asUser(ids.account, 'select email from profiles')).rows[0].email).toBe('updated@example.test')
})

test('map boundaries persist under owner permissions and malformed boundaries are rejected', async () => {
  const boundary = [{lat:37,lon:127},{lat:37.001,lon:127},{lat:37,lon:127.001}]
  const inserted = await asUser(ids.account,
    'insert into zombie_maps(name,center_lat,center_lon,radius_m,routes,owner_id,boundary) values($1,37,127,400,$2,$3,$4) returning id,boundary',
    ['Polygon', [[boundary[0],boundary[1]]], ids.account, boundary])
  expect(inserted.rows[0].boundary).toEqual(boundary)
  await expect(asUser(ids.account, 'update zombie_maps set boundary=$1 where id=$2', [[{lat:37,lon:127}], inserted.rows[0].id])).rejects.toThrow()
  expect((await asUser(ids.stranger,'update zombie_maps set boundary=null where id=$1 returning id',[inserted.rows[0].id])).rows).toHaveLength(0)
})

test('survival stats are room-private, bounded, monotonic and immutable after finish', async () => {
  const made = (await asUser(ids.stranger, "select zr_create_room('Rank test',$1) result", [{playMode:'free'}])).rows[0].result
  const room = made.room.id
  await asUser(ids.stranger, 'select zr_start_room($1)', [room])
  await db.query("update game_rooms set started_at=now()-interval '60 seconds' where id=$1", [room])
  await expect(asUser(ids.host, "select zr_update_stat_v2($1,1,6,'alive',10)", [room])).rejects.toThrow()
  await asUser(ids.stranger, "select zr_update_stat_v2($1,100,6,'alive',40)", [room])
  await asUser(ids.stranger, "select zr_update_stat_v2($1,50,6,'alive',10)", [room])
  expect((await db.query('select elapsed_sec,distance_m from room_players where room_id=$1',[room])).rows[0]).toEqual({elapsed_sec:40,distance_m:100})
  await expect(asUser(ids.stranger, "select zr_update_stat_v2($1,100,6,'alive',-1)", [room])).rejects.toThrow()
  await asUser(ids.stranger, "select zr_update_stat_v2($1,99999,0,'caught',80000)", [room])
  const result = (await asUser(ids.stranger, 'select zr_read_room($1) result', [room])).rows[0].result
  const final = result.players[0]
  expect(final.elapsed_sec).toBeGreaterThanOrEqual(60)
  expect(final.elapsed_sec).toBeLessThan(65)
  expect(final.distance_m).toBeLessThan(650)
  expect(final).not.toHaveProperty('auth_user_id')
  await asUser(ids.stranger, "select zr_update_stat_v2($1,99999,6,'alive',80000)", [room])
  expect((await asUser(ids.stranger, 'select zr_read_room($1) result', [room])).rows[0].result.players[0]).toEqual(final)
  await expect(asUser(ids.host, 'select zr_read_room($1)', [room])).rejects.toThrow()
})

test('personal codes restore identity across devices without exposing codes or other histories', async () => {
  const a = (await asUser(ids.host, "select zr_runner_connect('Solo A',null) result")).rows[0].result
  expect(a.code).toMatch(/^[0-9]{6}$/)
  expect((await asUser(ids.member,"select zr_runner_connect('Solo A','wrong') result")).rows[0].result.error).toBeTruthy()
  expect((await asUser(ids.member,'select zr_runner_me() result')).rows[0].result).toBeNull()
  const restored = (await asUser(ids.stranger,'select zr_runner_connect($1,$2) result',['Solo A',a.code.match(/.{1,3}/g).join('-').toLowerCase()])).rows[0].result
  expect(restored.runner).toEqual(a.runner)
  expect(restored.code).toBeNull()
  expect((await asUser(ids.stranger,'select zr_runner_me() result')).rows[0].result).toEqual(a.runner)
  await expect(asUser(ids.host,'select code_hash from zr_private.runners')).rejects.toThrow(/permission denied/)
  await asUser(ids.stranger,'select zr_runner_disconnect()')
  expect((await asUser(ids.stranger,'select zr_runner_me() result')).rows[0].result).toBeNull()
  expect((await asUser(ids.host,'select zr_runner_me() result')).rows[0].result).toEqual(a.runner)
})

test('personal bests, competing ranks, difficulty separation and idempotent finish use real SQL', async () => {
  await asUser(ids.member,"select zr_runner_connect('Solo B',null)")
  const runA='10000000-0000-4000-8000-000000000001', runA2='10000000-0000-4000-8000-000000000002', runB='10000000-0000-4000-8000-000000000003'
  const start = (user,id,pace=1) => asUser(user,"select zr_solo_start($1,'free',$2,1) result",[id,pace])
  const finish = (user,id,elapsed,distance) => asUser(user,"select zr_solo_update($1,$2,$3,'finished') result",[id,elapsed,distance])
  await start(ids.host,runA)
  await expect(start(ids.host,runA2)).rejects.toThrow(/진행 중/)
  await expect(finish(ids.member,runA,100,100)).rejects.toThrow()
  await db.query("update zr_private.solo_runs set started_at=now()-interval '100 seconds' where id=$1",[runA])
  const first=(await finish(ids.host,runA,60,100)).rows[0].result
  expect(first).toMatchObject({elapsed_sec:60,distance_m:100,is_best:true,previous_sec:null})
  expect((await finish(ids.host,runA,90,200)).rows[0].result).toEqual(first)
  await start(ids.host,runA2)
  await db.query("update zr_private.solo_runs set started_at=now()-interval '100 seconds' where id=$1",[runA2])
  const improved=(await finish(ids.host,runA2,80,120)).rows[0].result
  expect(improved).toMatchObject({is_best:true,previous_sec:60})
  await start(ids.member,runB)
  await db.query("update zr_private.solo_runs set started_at=now()-interval '100 seconds' where id=$1",[runB])
  await finish(ids.member,runB,90,100)
  const board=(await asUser(ids.host,"select zr_solo_board('free',1,1) result")).rows[0].result
  expect(board.total).toBe(2)
  expect(board.me).toMatchObject({nickname:'Solo A',rank:2,elapsed_sec:80})
  expect(board.players.map(p=>p.nickname)).toEqual(['Solo B','Solo A'])
  expect(board.recent).toHaveLength(2)
  expect(JSON.stringify(board)).not.toMatch(/code_hash|auth_user_id|runner_id/)
  expect((await asUser(ids.host,"select zr_solo_board('free',0,1) result")).rows[0].result.total).toBe(0)
  expect((await asUser(ids.member,"select zr_solo_board('free',1,1) result")).rows[0].result.recent).toHaveLength(1)
})

test('personal login attempts remain rate limited after wrong codes', async () => {
  for(let i=0;i<30;i++) await asUser(ids.stranger,"select zr_runner_connect('Solo A','bad')")
  const response=(await asUser(ids.stranger,"select zr_runner_connect('Solo A','bad') result")).rows[0].result
  expect(response.error).toMatch(/접속 시도가 많아요/)
})

test('a different map owner can share a map for a host to select and start', async () => {
  const map=(await asUser(ids.account,
    'insert into zombie_maps(name,center_lat,center_lon,radius_m,routes,owner_id) values($1,37,127,400,$2,$3) returning id',
    ['공유 테스트',[[{lat:37,lon:127},{lat:37.001,lon:127}]],ids.account])).rows[0]
  expect((await asUser(ids.member,'select id from zombie_maps where id=$1',[map.id])).rows).toHaveLength(1)
  const room=(await asUser(ids.member,"select zr_create_room('공유 맵 방장',$1) result",[{mapId:map.id,paceIdx:1}])).rows[0].result.room
  const started=(await asUser(ids.member,'select zr_start_room($1) result',[room.id])).rows[0].result
  expect(started.config.mapId).toBe(map.id)
  const soloId='20000000-0000-4000-8000-000000000001'
  await asUser(ids.host,'select zr_solo_start($1,$2,1,0)',[soloId,`map:${map.id}`])
  await db.query("update zr_private.solo_runs set started_at=now()-interval '30 seconds' where id=$1",[soloId])
  const result=(await asUser(ids.host,"select zr_solo_update($1,20,30,'finished') result",[soloId])).rows[0].result
  expect(result.previous_sec).toBeNull()
  const board=(await asUser(ids.host,'select zr_solo_board($1,1,0) result',[`map:${map.id}`])).rows[0].result
  expect(board.total).toBe(1)
  expect(board.me.elapsed_sec).toBe(20)
  expect((await asUser(ids.host,"select zr_solo_board('free',1,0) result")).rows[0].result.me.elapsed_sec).toBe(80)
  await expect(asUser(ids.host,'select zr_solo_start($1,$2,1,0)',['20000000-0000-4000-8000-000000000002','map:00000000-0000-0000-0000-000000000000'])).rejects.toThrow(/지도가 없어요/)
  expect((await asUser(ids.member,'update zombie_maps set name=$1 where id=$2 returning id',['변경 불가',map.id])).rows).toHaveLength(0)
})

test('six-digit change preserves records, rejects invalid codes and invalidates old credentials', async () => {
 const oldCode='ABCDEF0123456789ABCD'
 await db.query("update zr_private.runners set code_hash=sha256(convert_to($1,'UTF8')),code_attempts=0 where nickname_key='solo a'",[oldCode])
 const before=(await asUser(ids.host,"select zr_solo_board('free',1,0) result")).rows[0].result
 const restored=(await asUser(ids.member,'select zr_runner_connect($1,$2) result',['Solo A',oldCode])).rows[0].result
 expect(restored.runner.nickname).toBe('Solo A')
 await expect(asUser(ids.host,"select zr_runner_change_code('12345')")).rejects.toThrow(/6자리/)
 await asUser(ids.host,"select zr_runner_change_code('012345')")
 expect((await asUser(ids.member,'select zr_runner_me() result')).rows[0].result).toBeNull()
 expect((await asUser(ids.member,'select zr_runner_connect($1,$2) result',['Solo A',oldCode])).rows[0].result.error).toBeTruthy()
 expect((await asUser(ids.member,"select zr_runner_connect('Solo A','012345') result")).rows[0].result.runner.nickname).toBe('Solo A')
 expect((await asUser(ids.host,"select zr_solo_board('free',1,0) result")).rows[0].result).toEqual(before)
})
