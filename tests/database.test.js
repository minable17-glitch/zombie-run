// @vitest-environment node
import { beforeAll, afterAll, test, expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

const migration = ['20260909140000_zombie_run_security.sql', '20260910010000_room_expiration.sql', '20260911030000_legacy_profile_lookup.sql', '20260916010000_map_boundary.sql', '20260921010000_room_survival_rank.sql', '20260922010000_personal_survival.sql', '20260922020000_finished_rooms.sql', '20260923010000_solo_maps.sql', '20260923020000_six_digit_codes.sql', '20260923021000_code_attempt_guard.sql', '20260928010000_zombie_run_link.sql', '20260928020000_school_pause_state.sql', '20261014010000_self_chosen_signup_code.sql', '20261014020000_distance_goal_missions.sql', '20261016010000_time_goal_missions.sql', '20261019010000_pace_hold_missions.sql', '20261025010000_pace_energy_missions.sql']
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
  await expect(asUser(ids.host, "select zr_runner_connect('Solo A','12',true)")).rejects.toThrow(/6자리/)
  const a = (await asUser(ids.host, "select zr_runner_connect('Solo A','135790',true) result")).rows[0].result
  expect(a.runner.nickname).toBe('Solo A')
  expect((await asUser(ids.member,"select zr_runner_connect('Solo A','135790',true) result")).rows[0].result.error).toBeTruthy() // nickname taken, not a login
  expect((await asUser(ids.member,"select zr_runner_connect('Solo A','wrong') result")).rows[0].result.error).toBeTruthy()
  expect((await asUser(ids.member,'select zr_runner_me() result')).rows[0].result).toBeNull()
  const restored = (await asUser(ids.stranger,'select zr_runner_connect($1,$2) result',['Solo A','135-790'])).rows[0].result
  expect(restored.runner).toEqual(a.runner)
  expect((await asUser(ids.stranger,'select zr_runner_me() result')).rows[0].result).toEqual({...a.runner,schoolLinkedAt:null})
  await expect(asUser(ids.host,'select code_hash from zr_private.runners')).rejects.toThrow(/permission denied/)
  await asUser(ids.stranger,'select zr_runner_disconnect()')
  expect((await asUser(ids.stranger,'select zr_runner_me() result')).rows[0].result).toBeNull()
  expect((await asUser(ids.host,'select zr_runner_me() result')).rows[0].result).toEqual({...a.runner,schoolLinkedAt:null})
})

test('school-event linking is remembered on the runner and survives reconnecting from another device', async () => {
  const schoolUser = '00000000-0000-4000-8000-000000000010'
  await db.query('insert into auth.users(id,is_anonymous) values($1,true)', [schoolUser])
  await expect(asUser(ids.stranger,'select zr_runner_school_link()')).rejects.toThrow(/접속이 만료/)
  await asUser(schoolUser,"select zr_runner_connect('Solo Linked','246810',true)")
  const linked = (await asUser(schoolUser,'select zr_runner_school_link() result')).rows[0].result
  expect(linked.schoolLinkedAt).toBeTruthy()
  expect((await asUser(schoolUser,'select zr_runner_me() result')).rows[0].result.schoolLinkedAt).toBe(linked.schoolLinkedAt)
  const relinked = (await asUser(schoolUser,'select zr_runner_school_link() result')).rows[0].result
  expect(relinked.schoolLinkedAt).toBe(linked.schoolLinkedAt)
  await asUser(schoolUser,'select zr_runner_disconnect()')
})

test('personal bests, competing ranks, difficulty separation and idempotent finish use real SQL', async () => {
  await asUser(ids.member,"select zr_runner_connect('Solo B','222222',true)")
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

test('solo distance-goal runs record how fast the goal was reached and rank separately from survival', async () => {
  const goalUser = '00000000-0000-4000-8000-000000000011'
  await db.query('insert into auth.users(id,is_anonymous) values($1,true)', [goalUser])
  await asUser(goalUser,"select zr_runner_connect('Goal Runner','654321',true)")
  const runId='30000000-0000-4000-8000-000000000001'
  await expect(asUser(goalUser,"select zr_solo_start($1,'free',1,1,99999)",[runId])).rejects.toThrow()
  await asUser(goalUser,"select zr_solo_start($1,'free',1,1,4000) result",[runId])
  await db.query("update zr_private.solo_runs set started_at=now()-interval '600 seconds' where id=$1",[runId])
  const mid=(await asUser(goalUser,"select zr_solo_update($1,300,2500,'alive') result",[runId])).rows[0].result
  expect(mid.goal_reached_sec).toBeNull()
  const reached=(await asUser(goalUser,"select zr_solo_update($1,500,4000,'alive') result",[runId])).rows[0].result
  expect(reached.goal_reached_sec).toBe(500)
  const finished=(await asUser(goalUser,"select zr_solo_update($1,520,4100,'finished') result",[runId])).rows[0].result
  expect(finished.goal_reached_sec).toBe(500) // reaching the goal earlier is what's ranked, not the eventual finish
  expect(finished).toMatchObject({is_best:true,previous_sec:null}) // first-ever goal completion, not compared against survival runs
  const board=(await asUser(goalUser,"select zr_solo_board('free',1,1,4000) result")).rows[0].result
  expect(board.me).toMatchObject({nickname:'Goal Runner',goal_reached_sec:500,rank:1})
  expect(board.total).toBe(1)
  expect((await asUser(goalUser,"select zr_solo_board('free',1,1) result")).rows[0].result.me).toBeNull()
  // a faster second run improves the goal record; a slower third run does not
  const runId2='30000000-0000-4000-8000-000000000002'
  await asUser(goalUser,"select zr_solo_start($1,'free',1,1,4000)",[runId2])
  await db.query("update zr_private.solo_runs set started_at=now()-interval '600 seconds' where id=$1",[runId2])
  const faster=(await asUser(goalUser,"select zr_solo_update($1,400,4000,'finished') result",[runId2])).rows[0].result
  expect(faster).toMatchObject({goal_reached_sec:400,is_best:true,previous_sec:500})
  const runId3='30000000-0000-4000-8000-000000000003'
  await asUser(goalUser,"select zr_solo_start($1,'free',1,1,4000)",[runId3])
  await db.query("update zr_private.solo_runs set started_at=now()-interval '600 seconds' where id=$1",[runId3])
  const slower=(await asUser(goalUser,"select zr_solo_update($1,450,4000,'finished') result",[runId3])).rows[0].result
  expect(slower).toMatchObject({goal_reached_sec:450,is_best:false,previous_sec:400})
  await asUser(goalUser,'select zr_runner_disconnect()')
})

test('solo time-goal runs record how far the goal time was covered and rank separately from survival', async () => {
  const timeUser = '00000000-0000-4000-8000-000000000012'
  await db.query('insert into auth.users(id,is_anonymous) values($1,true)', [timeUser])
  await asUser(timeUser,"select zr_runner_connect('Time Runner','135791',true)")
  const runId='30000000-0000-4000-8000-000000000004'
  await expect(asUser(timeUser,"select zr_solo_start($1,'free',1,1,0,99999)",[runId])).rejects.toThrow()
  await expect(asUser(timeUser,"select zr_solo_start($1,'free',1,1,1000,600)",[runId])).rejects.toThrow() // can't set both goals
  await asUser(timeUser,"select zr_solo_start($1,'free',1,1,0,600) result",[runId])
  await db.query("update zr_private.solo_runs set started_at=now()-interval '700 seconds' where id=$1",[runId])
  const mid=(await asUser(timeUser,"select zr_solo_update($1,300,2500,'alive') result",[runId])).rows[0].result
  expect(mid.goal_reached_m).toBeNull()
  const reached=(await asUser(timeUser,"select zr_solo_update($1,600,5000,'alive') result",[runId])).rows[0].result
  expect(reached.goal_reached_m).toBe(5000)
  const finished=(await asUser(timeUser,"select zr_solo_update($1,650,5200,'finished') result",[runId])).rows[0].result
  expect(finished.goal_reached_m).toBe(5000) // distance at goal time is what's ranked, not the eventual finish distance
  expect(finished).toMatchObject({is_best:true,previous_sec:null})
  const board=(await asUser(timeUser,"select zr_solo_board('free',1,1,0,600) result")).rows[0].result
  expect(board.me).toMatchObject({nickname:'Time Runner',goal_reached_m:5000,rank:1})
  expect(board.total).toBe(1)
  expect((await asUser(timeUser,"select zr_solo_board('free',1,1) result")).rows[0].result.me).toBeNull()
  // a farther second run improves the record; a shorter third run does not
  const runId2='30000000-0000-4000-8000-000000000005'
  await asUser(timeUser,"select zr_solo_start($1,'free',1,1,0,600)",[runId2])
  await db.query("update zr_private.solo_runs set started_at=now()-interval '700 seconds' where id=$1",[runId2])
  const farther=(await asUser(timeUser,"select zr_solo_update($1,600,6000,'finished') result",[runId2])).rows[0].result
  expect(farther).toMatchObject({goal_reached_m:6000,is_best:true})
  const runId3='30000000-0000-4000-8000-000000000006'
  await asUser(timeUser,"select zr_solo_start($1,'free',1,1,0,600)",[runId3])
  await db.query("update zr_private.solo_runs set started_at=now()-interval '700 seconds' where id=$1",[runId3])
  const shorter=(await asUser(timeUser,"select zr_solo_update($1,600,5500,'finished') result",[runId3])).rows[0].result
  expect(shorter).toMatchObject({goal_reached_m:5500,is_best:false})
  await asUser(timeUser,'select zr_runner_disconnect()')
})

test('room distance-goal runs share the same goal from room config and track each player\'s reach time', async () => {
  const made=(await asUser(ids.host,"select zr_create_room('Goal Host',$1) result",[{playMode:'free',missionGoalM:2000,missionContinue:true}])).rows[0].result
  expect(made.room.config).toMatchObject({missionGoalM:2000,missionContinue:true})
  const room=made.room.id
  await asUser(ids.host,'select zr_start_room($1)',[room])
  await db.query("update game_rooms set started_at=now()-interval '300 seconds' where id=$1",[room])
  await asUser(ids.host,"select zr_update_stat_v2($1,1500,6,'alive',150)",[room])
  let snapshot=(await asUser(ids.host,'select zr_read_room($1) result',[room])).rows[0].result
  expect(snapshot.players.find(p=>p.id===made.player.id).goal_reached_sec).toBeNull()
  await asUser(ids.host,"select zr_update_stat_v2($1,2000,6,'alive',200)",[room])
  snapshot=(await asUser(ids.host,'select zr_read_room($1) result',[room])).rows[0].result
  expect(snapshot.players.find(p=>p.id===made.player.id).goal_reached_sec).toBe(200)
})

test('room time-goal runs share the same goal time and track how far each player got', async () => {
  const made=(await asUser(ids.host,"select zr_create_room('Time Host',$1) result",[{playMode:'free',missionGoalSec:300}])).rows[0].result
  expect(made.room.config).toMatchObject({missionGoalSec:300,missionGoalM:0})
  const room=made.room.id
  await asUser(ids.host,'select zr_start_room($1)',[room])
  await db.query("update game_rooms set started_at=now()-interval '400 seconds' where id=$1",[room])
  await asUser(ids.host,"select zr_update_stat_v2($1,2000,6,'alive',250)",[room])
  let snapshot=(await asUser(ids.host,'select zr_read_room($1) result',[room])).rows[0].result
  expect(snapshot.players.find(p=>p.id===made.player.id).goal_reached_m).toBeNull()
  await asUser(ids.host,"select zr_update_stat_v2($1,2800,6,'alive',300)",[room])
  snapshot=(await asUser(ids.host,'select zr_read_room($1) result',[room])).rows[0].result
  expect(snapshot.players.find(p=>p.id===made.player.id).goal_reached_m).toBe(2800)
})

test('solo pace-hold runs record how fast the goal was reached and rank separately from survival', async () => {
  const paceUser = '00000000-0000-4000-8000-000000000013'
  await db.query('insert into auth.users(id,is_anonymous) values($1,true)', [paceUser])
  await asUser(paceUser,"select zr_runner_connect('Pace Runner','246810',true)")
  const runId='30000000-0000-4000-8000-000000000007'
  await expect(asUser(paceUser,"select zr_solo_start($1,'free',1,1,0,0,99999)",[runId])).rejects.toThrow()
  await expect(asUser(paceUser,"select zr_solo_start($1,'free',1,1,1000,0,300)",[runId])).rejects.toThrow() // can't set both goals
  await asUser(paceUser,"select zr_solo_start($1,'free',1,1,0,0,300) result",[runId])
  await db.query("update zr_private.solo_runs set started_at=now()-interval '600 seconds' where id=$1",[runId])
  const mid=(await asUser(paceUser,"select zr_solo_update($1,250,2000,'alive') result",[runId])).rows[0].result
  expect(mid.pace_reached_sec).toBeNull() // no pace_reached_sec reported yet
  const reached=(await asUser(paceUser,"select zr_solo_update($1,400,3000,'alive',300) result",[runId])).rows[0].result
  expect(reached.pace_reached_sec).toBe(300)
  const finished=(await asUser(paceUser,"select zr_solo_update($1,450,3200,'finished',320) result",[runId])).rows[0].result
  expect(finished.pace_reached_sec).toBe(300) // only the first report is kept, a later one doesn't move it
  expect(finished).toMatchObject({is_best:true,previous_sec:null})
  const board=(await asUser(paceUser,"select zr_solo_board('free',1,1,0,0,300) result")).rows[0].result
  expect(board.me).toMatchObject({nickname:'Pace Runner',pace_reached_sec:300,rank:1})
  expect(board.total).toBe(1)
  expect((await asUser(paceUser,"select zr_solo_board('free',1,1) result")).rows[0].result.me).toBeNull()
  // a faster second run improves the record; a slower third run does not
  const runId2='30000000-0000-4000-8000-000000000008'
  await asUser(paceUser,"select zr_solo_start($1,'free',1,1,0,0,300)",[runId2])
  await db.query("update zr_private.solo_runs set started_at=now()-interval '600 seconds' where id=$1",[runId2])
  const faster=(await asUser(paceUser,"select zr_solo_update($1,280,2800,'finished',250) result",[runId2])).rows[0].result
  expect(faster).toMatchObject({pace_reached_sec:250,is_best:true,previous_sec:null})
  const runId3='30000000-0000-4000-8000-000000000009'
  await asUser(paceUser,"select zr_solo_start($1,'free',1,1,0,0,300)",[runId3])
  await db.query("update zr_private.solo_runs set started_at=now()-interval '600 seconds' where id=$1",[runId3])
  const slower=(await asUser(paceUser,"select zr_solo_update($1,290,2900,'finished',280) result",[runId3])).rows[0].result
  expect(slower).toMatchObject({pace_reached_sec:280,is_best:false})
  await asUser(paceUser,'select zr_runner_disconnect()')
})

test('room pace-hold runs share the same goal from room config and track each player\'s reach time', async () => {
  const made=(await asUser(ids.host,"select zr_create_room('Pace Host',$1) result",[{playMode:'free',missionGoalPaceSec:200}])).rows[0].result
  expect(made.room.config).toMatchObject({missionGoalPaceSec:200,missionGoalM:0,missionGoalSec:0})
  const room=made.room.id
  await asUser(ids.host,'select zr_start_room($1)',[room])
  await db.query("update game_rooms set started_at=now()-interval '300 seconds' where id=$1",[room])
  await asUser(ids.host,"select zr_update_stat_v2($1,1500,6,'alive',150)",[room])
  let snapshot=(await asUser(ids.host,'select zr_read_room($1) result',[room])).rows[0].result
  expect(snapshot.players.find(p=>p.id===made.player.id).pace_reached_sec).toBeNull()
  await asUser(ids.host,"select zr_update_stat_v2($1,2000,6,'alive',200,200)",[room])
  snapshot=(await asUser(ids.host,'select zr_read_room($1) result',[room])).rows[0].result
  expect(snapshot.players.find(p=>p.id===made.player.id).pace_reached_sec).toBe(200)
  // reporting a different value afterward doesn't move it once it's set
  await asUser(ids.host,"select zr_update_stat_v2($1,2200,6,'alive',220,210)",[room])
  snapshot=(await asUser(ids.host,'select zr_read_room($1) result',[room])).rows[0].result
  expect(snapshot.players.find(p=>p.id===made.player.id).pace_reached_sec).toBe(200)
})

test('pace-energy solo runs rank by score; time/distance need a cleared run, endless ranks every run', async () => {
  const u = '00000000-0000-4000-8000-000000000014'
  await db.query('insert into auth.users(id,is_anonymous) values($1,true)', [u])
  await asUser(u,"select zr_runner_connect('Energy Runner','975310',true)")
  const id = n => `40000000-0000-4000-8000-00000000000${n}`
  // invalid settings: bad goal for the kind, endless with a goal, combined with another mission
  await expect(asUser(u,"select zr_solo_start($1,'free',1,1,0,0,0,1,30)",[id(1)])).rejects.toThrow()
  await expect(asUser(u,"select zr_solo_start($1,'free',1,1,0,0,0,3,600)",[id(1)])).rejects.toThrow()
  await expect(asUser(u,"select zr_solo_start($1,'free',1,1,1000,0,0,2,1000)",[id(1)])).rejects.toThrow()
  // time mode 600s: score is capped at elapsed*10, a cleared claim needs elapsed >= goal
  await asUser(u,"select zr_solo_start($1,'free',1,1,0,0,0,1,600)",[id(1)])
  await db.query("update zr_private.solo_runs set started_at=now()-interval '700 seconds' where id=$1",[id(1)])
  const mid=(await asUser(u,"select zr_solo_update($1,100,300,'alive',null,99999) result",[id(1)])).rows[0].result
  expect(mid.pace_score).toBe(1000)
  const early=(await asUser(u,"select zr_solo_update($1,300,900,'caught',null,2500,true) result",[id(1)])).rows[0].result
  expect(early).toMatchObject({pace_score:2500,pace_cleared:false,is_best:false}) // only 300s of 600 — claim refused
  await asUser(u,"select zr_solo_start($1,'free',1,1,0,0,0,1,600)",[id(2)])
  await db.query("update zr_private.solo_runs set started_at=now()-interval '700 seconds' where id=$1",[id(2)])
  const ok=(await asUser(u,"select zr_solo_update($1,600,1800,'caught',null,5000,true) result",[id(2)])).rows[0].result
  expect(ok).toMatchObject({pace_score:5000,pace_cleared:true,is_best:true,previous_sec:null})
  let board=(await asUser(u,"select zr_solo_board('free',1,1,0,0,0,1,600) result")).rows[0].result
  expect(board.total).toBe(1)
  expect(board.me).toMatchObject({nickname:'Energy Runner',pace_score:5000,rank:1})
  expect((await asUser(u,"select zr_solo_board('free',1,1,0,0,0,1,300) result")).rows[0].result.total).toBe(0) // other goal = other board
  expect((await asUser(u,"select zr_solo_board('free',1,1) result")).rows[0].result.me).toBeNull() // not mixed into survival
  // a lower cleared score is not a new best
  await asUser(u,"select zr_solo_start($1,'free',1,1,0,0,0,1,600)",[id(3)])
  await db.query("update zr_private.solo_runs set started_at=now()-interval '700 seconds' where id=$1",[id(3)])
  expect((await asUser(u,"select zr_solo_update($1,600,1800,'caught',null,4000,true) result",[id(3)])).rows[0].result.is_best).toBe(false)
  // distance mode: cleared only when the server-capped distance reaches the goal
  await asUser(u,"select zr_solo_start($1,'free',1,1,0,0,0,2,1000)",[id(4)])
  await db.query("update zr_private.solo_runs set started_at=now()-interval '700 seconds' where id=$1",[id(4)])
  expect((await asUser(u,"select zr_solo_update($1,400,1200,'caught',null,3000,true) result",[id(4)])).rows[0].result.pace_cleared).toBe(true)
  // endless: ranked even though it ended by running out of energy
  await asUser(u,"select zr_solo_start($1,'free',1,1,0,0,0,3,0)",[id(5)])
  await db.query("update zr_private.solo_runs set started_at=now()-interval '700 seconds' where id=$1",[id(5)])
  const endless=(await asUser(u,"select zr_solo_update($1,500,1500,'caught',null,3200,false) result",[id(5)])).rows[0].result
  expect(endless).toMatchObject({pace_score:3200,pace_cleared:null,is_best:true})
  board=(await asUser(u,"select zr_solo_board('free',1,1,0,0,0,3,0) result")).rows[0].result
  expect(board.me).toMatchObject({pace_score:3200,rank:1})
  await asUser(u,'select zr_runner_disconnect()')
})

test('pace-energy room runs share the mode from config and keep score and clear per player', async () => {
  await expect(asUser(ids.host,"select zr_create_room('Bad',$1)",[{playMode:'free',missionPaceKind:3,missionPaceGoal:100}])).rejects.toThrow()
  await expect(asUser(ids.host,"select zr_create_room('Bad',$1)",[{playMode:'free',missionPaceKind:1,missionPaceGoal:600,missionGoalM:1000}])).rejects.toThrow()
  const made=(await asUser(ids.host,"select zr_create_room('Energy Host',$1) result",[{playMode:'free',missionPaceKind:1,missionPaceGoal:300}])).rows[0].result
  expect(made.room.config).toMatchObject({missionPaceKind:1,missionPaceGoal:300,missionGoalM:0,missionGoalSec:0,missionGoalPaceSec:0})
  const room=made.room.id
  await asUser(ids.host,'select zr_start_room($1)',[room])
  await db.query("update game_rooms set started_at=now()-interval '400 seconds' where id=$1",[room])
  await asUser(ids.host,"select zr_update_stat_v2($1,500,6,'alive',100,null,99999)",[room])
  let me=(await asUser(ids.host,'select zr_read_room($1) result',[room])).rows[0].result.players.find(p=>p.id===made.player.id)
  expect(me).toMatchObject({pace_score:1000,pace_cleared:null})
  await asUser(ids.host,"select zr_update_stat_v2($1,900,6,'caught',300,null,2800,true)",[room])
  me=(await asUser(ids.host,'select zr_read_room($1) result',[room])).rows[0].result.players.find(p=>p.id===made.player.id)
  expect(me).toMatchObject({pace_score:2800,pace_cleared:true})
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
