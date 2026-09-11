// @vitest-environment node
import { beforeAll, afterAll, test, expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

const migration = ['20260909140000_zombie_run_security.sql', '20260910010000_room_expiration.sql', '20260911030000_legacy_profile_lookup.sql']
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
