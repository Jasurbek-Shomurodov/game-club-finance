// A stand-in for Supabase, for the browser tests only. The app's own migration chain (migrations/) runs in PGlite,
// the same in-process Postgres the unit tests under src/lib/supabase use, behind the parts of the PostgREST and Auth
// HTTP APIs the app calls. Every request runs as the caller's role with their JWT claims and headers set the way
// PostgREST sets them, so row-level security, triggers and the app's database functions behave as in production:
// club isolation is tested, not bypassed. Nothing here is imported by the app.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { anonKey as defaultAnonKey, serviceKey as defaultServiceKey } from './settings.mjs';

const identifier = name => { if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw httpError(400, 'PGRST100', `Unexpected name ${name}`); return `"${name}"`; };
function httpError(status, code, message, details = null) { return Object.assign(new Error(message), { status, body: { code, message, details, hint: null } }); }
const base64url = buffer => Buffer.from(buffer).toString('base64url');

// The roles, auth helpers and platform extensions Supabase provides (pg_cron, pg_net and vault are stubs: the
// migrations schedule jobs and read secrets, nothing here runs them). Tables are granted the way Supabase's default
// privileges grant them; the migrations' own GRANT and REVOKE statements still apply on top.
const shim = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now());
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'$$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
CREATE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'email'$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO service_role;
CREATE FUNCTION public.uuid_generate_v4() RETURNS uuid LANGUAGE sql VOLATILE AS $$SELECT gen_random_uuid()$$;
CREATE SCHEMA cron; CREATE TABLE cron.job(jobid bigserial PRIMARY KEY, jobname text, schedule text, command text);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$INSERT INTO cron.job(jobname,schedule,command) VALUES (job_name,schedule,command) RETURNING jobid$$;
CREATE FUNCTION cron.unschedule(job_id bigint) RETURNS boolean LANGUAGE sql AS $$DELETE FROM cron.job WHERE jobid=job_id RETURNING true$$;
CREATE SCHEMA extensions; CREATE SCHEMA net;
CREATE FUNCTION net.http_get(url text, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 2000) RETURNS bigint LANGUAGE sql AS $$SELECT 1::bigint$$;
CREATE SCHEMA vault; CREATE TABLE vault.decrypted_secrets(id uuid DEFAULT gen_random_uuid(), name text, decrypted_secret text);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;`;

/** A fresh database with the whole migration chain applied in order (001_initial_schema.sql is not a schema by itself). */
export async function createDatabase(migrationsDir = new URL('../migrations/', import.meta.url)) {
  const db = new PGlite();
  await db.exec(shim);
  const files = fs.readdirSync(migrationsDir).filter(file => /^\d+_[A-Za-z0-9_]+\.sql$/.test(file)).sort((a, b) => Number(a.split('_')[0]) - Number(b.split('_')[0]));
  for (const file of files) {
    // Platform extensions are stubbed above; PGlite cannot load them.
    const sql = fs.readFileSync(new URL(file, migrationsDir), 'utf8').replace(/^\s*create extension if not exists [^;]+;/gim, '');
    try { await db.exec(sql); } catch (error) { throw new Error(`Migration ${file} failed in PGlite: ${error.message}`); }
  }
  return db;
}

/** Column types, keys, relationships and functions, cached. Each lookup runs in the caller's transaction, since
 * PGlite has one connection. */
function catalog() {
  const columns = new Map(), relations = new Map(), functions = new Map();
  return {
    async columns(db, table) {
      if (!columns.has(table)) {
        const { rows } = await db.query(`SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped`, [table]);
        if (!rows.length) throw httpError(404, 'PGRST205', `Could not find the table 'public.${table}'`);
        columns.set(table, new Map(rows.map(row => [row.name, row.type])));
      }
      return columns.get(table);
    },
    async primaryKey(db, table) {
      const { rows } = await db.query(`SELECT a.attname AS name FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=ANY(i.indkey)
        WHERE n.nspname='public' AND c.relname=$1 AND i.indisprimary`, [table]);
      return rows.map(row => row.name);
    },
    /** How `table` embeds `other`: one row it points at, or the rows pointing at it. `hint` names the foreign-key
     * column when the tables are linked more than once. As in PostgREST, rows pointing at it through a unique column
     * are one-to-one: one object or null. */
    async relation(db, table, other, hint) {
      const key = table + '>' + other;
      if (!relations.has(key)) {
        const { rows } = await db.query(`SELECT src.relname AS source, (SELECT attname FROM pg_attribute WHERE attrelid=k.conrelid AND attnum=k.conkey[1]) AS source_column,
            (SELECT attname FROM pg_attribute WHERE attrelid=k.confrelid AND attnum=k.confkey[1]) AS target_column,
            EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid=k.conrelid AND i.indisunique AND i.indnkeyatts=1 AND i.indkey[0]=k.conkey[1]) AS unique_source
          FROM pg_constraint k JOIN pg_class src ON src.oid=k.conrelid JOIN pg_class tgt ON tgt.oid=k.confrelid JOIN pg_namespace n ON n.oid=src.relnamespace
          WHERE k.contype='f' AND n.nspname='public' AND ((src.relname=$1 AND tgt.relname=$2) OR (src.relname=$2 AND tgt.relname=$1))`, [table, other]);
        relations.set(key, rows.map(row => row.source === table ? { many: false, local: row.source_column, remote: row.target_column, column: row.source_column } : { many: !row.unique_source, local: row.target_column, remote: row.source_column, column: row.source_column }));
      }
      const links = relations.get(key).filter(link => !hint || link.column === hint);
      if (!links.length) throw httpError(400, 'PGRST200', `Could not find a relationship between '${table}' and '${other}'`);
      return links[0];
    },
    async functionsNamed(db, name) {
      if (!functions.has(name)) {
        const { rows } = await db.query(`SELECT p.oid, p.proargnames AS names, p.pronargs AS count, p.pronargdefaults AS defaults, p.proretset AS returns_set,
            format_type(p.prorettype,NULL) AS returns, t.typtype AS return_kind,
            ARRAY(SELECT format_type(x,NULL) FROM unnest(p.proargtypes) x) AS types
          FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_type t ON t.oid=p.prorettype WHERE n.nspname='public' AND p.proname=$1`, [name]);
        functions.set(name, rows);
      }
      return functions.get(name);
    },
  };
}

/** A value bound for a column or argument of `type`: JSON and arrays travel as JSON text and are cast in SQL. */
function bind(params, value, type) {
  if (value === null || value === undefined) return 'NULL';
  if (/\[\]$/.test(type)) { params.push(JSON.stringify(value)); return `ARRAY(SELECT jsonb_array_elements_text($${params.length}::jsonb))::${type}`; }
  if (type === 'json' || type === 'jsonb') { params.push(JSON.stringify(value)); return `$${params.length}::${type}`; }
  params.push(typeof value === 'object' ? JSON.stringify(value) : String(value));
  return `$${params.length}::${type}`;
}

/** Splits a PostgREST list at top-level commas: `a.eq.1,and(b.gt.2,c.lt.3)`. */
function splitTop(text) {
  const parts = []; let depth = 0, current = '';
  for (const char of text) { if (char === '(') depth++; if (char === ')') depth--; if (char === ',' && depth === 0) { parts.push(current); current = ''; } else current += char; }
  if (current) parts.push(current);
  return parts;
}
const comparisons = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'LIKE', ilike: 'ILIKE' };
/** One condition `operator.value` (with `not.` in front to negate) on a column. */
function condition(target, expression, params) {
  let rest = expression, negate = false;
  if (rest.startsWith('not.')) { negate = true; rest = rest.slice(4); }
  const dot = rest.indexOf('.');
  const operator = rest.slice(0, dot), value = rest.slice(dot + 1);
  let clause;
  // Comparisons take the column's type from the untyped parameter; patterns compare as text.
  if (comparisons[operator]) { const like = operator.endsWith('like'); params.push(like ? value.replaceAll('*', '%') : value); clause = like ? `${target}::text ${comparisons[operator]} $${params.length}` : `${target} ${comparisons[operator]} $${params.length}`; }
  else if (operator === 'is') clause = `${target} IS ${{ null: 'NULL', true: 'TRUE', false: 'FALSE' }[value.toLowerCase()] ?? 'NULL'}`;
  else if (operator === 'in') {
    const items = value.replace(/^\(|\)$/g, '').match(/"[^"]*"|[^,]+/g) ?? [];
    clause = items.length ? `${target} IN (${items.map(item => { params.push(item.replace(/^"|"$/g, '')); return `$${params.length}`; }).join(',')})` : 'FALSE';
  } else if (operator === 'cs') { params.push(value); clause = `${target} @> $${params.length}`; }
  else throw httpError(400, 'PGRST100', `Unsupported filter ${operator}`);
  return negate ? `NOT (${clause})` : clause;
}
/** A logic tree `(a.eq.1,and(b.gt.2,not.c.is.null))` joined by `joiner`. */
function logic(joiner, list, alias, params) {
  const items = splitTop(list.replace(/^\(|\)$/g, '')).map(item => {
    const nested = item.match(/^(not\.)?(and|or)\((.*)\)$/);
    if (nested) { const inner = logic(nested[2] === 'and' ? 'AND' : 'OR', nested[3], alias, params); return nested[1] ? `NOT ${inner}` : inner; }
    const dot = item.indexOf('.');
    return condition(`${alias}.${identifier(item.slice(0, dot))}`, item.slice(dot + 1), params);
  });
  return `(${items.join(` ${joiner} `)})`;
}
/** Filters on the base table (`column=op.value`, `or=(…)`, `and=(…)`) or, with `prefix`, on an embedded one. */
function filters(search, alias, params, prefix = '') {
  const reserved = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
  const clauses = [];
  for (const [key, raw] of search) {
    if (reserved.has(key)) continue;
    if (prefix ? !key.startsWith(prefix + '.') : key.includes('.')) continue;
    const column = prefix ? key.slice(prefix.length + 1) : key;
    if (column === 'or' || column === 'and') clauses.push(logic(column.toUpperCase(), raw, alias, params));
    else if (column === 'not.or' || column === 'not.and') clauses.push(`NOT ${logic(column.slice(4).toUpperCase(), raw, alias, params)}`);
    else clauses.push(condition(`${alias}.${identifier(column)}`, raw, params));
  }
  return clauses;
}
const where = clauses => clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';

function order(value, alias) {
  if (!value) return '';
  return ' ORDER BY ' + value.split(',').map(part => {
    const [column, ...flags] = part.split('.');
    return `${alias}.${identifier(column)}${flags.includes('desc') ? ' DESC' : ' ASC'}${flags.includes('nullsfirst') ? ' NULLS FIRST' : flags.includes('nullslast') ? ' NULLS LAST' : ''}`;
  }).join(', ');
}

/** `*`, columns, `alias:column`, and one level of embedding: `name(columns)`, `alias:name!fk_column(columns)` and
 * `name!inner(columns)`, whose filters (`name.column=…`) narrow the embedded rows, and with `!inner` the base rows
 * too. Returns the select list and the conditions `!inner` adds. */
async function projection(tx, search, table, alias, schema, params) {
  const out = [], inner = [];
  for (const part of splitTop(search.get('select') || '*').map(item => item.trim())) {
    const embed = part.match(/^(?:([a-z_][a-z0-9_]*):)?([a-z_][a-z0-9_]*)(?:!([a-z_]+))?\((.*)\)$/i);
    if (embed) {
      const [, label, other, hint, columns] = embed, isInner = hint === 'inner';
      const link = await schema.relation(tx, table, other, isInner ? undefined : hint), sub = 'e_' + other;
      const body = columns.trim() === '*' ? `to_jsonb(${sub})` : `jsonb_build_object(${columns.split(',').map(column => `'${column.trim()}',${sub}.${identifier(column.trim())}`).join(',')})`;
      const conditions = [`${sub}.${identifier(link.remote)} = ${alias}.${identifier(link.local)}`, ...filters(search, sub, params, label ?? other)];
      out.push(link.many ? `(SELECT coalesce(jsonb_agg(${body}),'[]'::jsonb) FROM public.${identifier(other)} ${sub} WHERE ${conditions.join(' AND ')}) AS ${identifier(label ?? other)}`
        : `(SELECT ${body} FROM public.${identifier(other)} ${sub} WHERE ${conditions.join(' AND ')}) AS ${identifier(label ?? other)}`);
      if (isInner) inner.push(`EXISTS (SELECT 1 FROM public.${identifier(other)} ${sub} WHERE ${conditions.join(' AND ')})`);
    } else if (part === '*') out.push(`${alias}.*`);
    else { const [label, column] = part.includes(':') ? part.split(':') : [part, part]; out.push(`${alias}.${identifier(column)} AS ${identifier(label)}`); }
  }
  return { select: out.join(', '), inner };
}

async function rest(tx, schema, request) {
  const { method, table, search, body, prefer, headers } = request;
  const params = [];
  const returning = prefer.includes('return=representation');
  const single = (headers.accept ?? '').includes('application/vnd.pgrst.object+json');
  if (method === 'GET' || method === 'HEAD') {
    const { select, inner } = await projection(tx, search, table, 't', schema, params);
    const conditions = where([...filters(search, 't', params), ...inner]);
    let limit = search.get('limit'), offset = search.get('offset');
    const range = headers.range?.match(/^(\d+)-(\d*)$/);
    if (range) { offset = range[1]; if (range[2]) limit = String(Number(range[2]) - Number(range[1]) + 1); }
    const sql = `SELECT coalesce(jsonb_agg(x),'[]'::jsonb) AS body FROM (SELECT ${select} FROM public.${identifier(table)} t${conditions}${order(search.get('order'), 't')}${limit ? ` LIMIT ${Number(limit)}` : ''}${offset ? ` OFFSET ${Number(offset)}` : ''}) x`;
    const rows = (await tx.query(sql, params)).rows[0].body;
    const extra = {};
    const start = Number(offset ?? 0);
    if (prefer.includes('count=exact')) { const total = (await tx.query(`SELECT count(*)::int AS n FROM public.${identifier(table)} t${conditions}`, params)).rows[0].n; extra['Content-Range'] = `${rows.length ? `${start}-${start + rows.length - 1}` : '*'}/${total}`; }
    else extra['Content-Range'] = `${rows.length ? `${start}-${start + rows.length - 1}` : '*'}/*`;
    if (method === 'HEAD') return { status: 200, body: null, headers: extra };
    if (single) { if (rows.length !== 1) throw httpError(406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned'); return { status: 200, body: rows[0], headers: extra }; }
    return { status: 200, body: rows, headers: extra };
  }
  const columns = await schema.columns(tx, table);
  if (method === 'POST') {
    const list = Array.isArray(body) ? body : [body];
    if (!list.length) return { status: 201, body: returning ? [] : null };
    const names = [...new Set(list.flatMap(row => Object.keys(row)))].filter(name => columns.has(name));
    const values = list.map(row => `(${names.map(name => name in row ? bind(params, row[name], columns.get(name)) : 'DEFAULT').join(',')})`);
    let conflict = '';
    if (prefer.includes('resolution=')) {
      const keys = search.get('on_conflict')?.split(',') ?? await schema.primaryKey(tx, table);
      conflict = prefer.includes('resolution=ignore-duplicates') ? ` ON CONFLICT (${keys.map(identifier).join(',')}) DO NOTHING`
        : ` ON CONFLICT (${keys.map(identifier).join(',')}) DO UPDATE SET ${names.filter(name => !keys.includes(name)).map(name => `${identifier(name)}=EXCLUDED.${identifier(name)}`).join(',') || `${identifier(keys[0])}=EXCLUDED.${identifier(keys[0])}`}`;
    }
    const sql = `WITH t AS (INSERT INTO public.${identifier(table)} (${names.map(identifier).join(',')}) VALUES ${values.join(',')}${conflict} RETURNING *) SELECT coalesce(jsonb_agg(t),'[]'::jsonb) AS body FROM t`;
    const rows = (await tx.query(sql, params)).rows[0].body;
    if (!returning) return { status: 201, body: null };
    if (single) { if (rows.length > 1) throw httpError(406, 'PGRST116', 'JSON object requested, multiple rows returned'); return { status: 201, body: rows[0] ?? null }; }
    return { status: 201, body: rows };
  }
  if (method === 'PATCH') {
    const sets = Object.entries(body ?? {}).filter(([name]) => columns.has(name)).map(([name, value]) => `${identifier(name)}=${bind(params, value, columns.get(name))}`);
    const sql = `WITH u AS (UPDATE public.${identifier(table)} t SET ${sets.join(',')}${where(filters(search, 't', params))} RETURNING t.*) SELECT coalesce(jsonb_agg(u),'[]'::jsonb) AS body FROM u`;
    const rows = (await tx.query(sql, params)).rows[0].body;
    return returning ? { status: 200, body: single ? rows[0] ?? null : rows } : { status: 204, body: null };
  }
  if (method === 'DELETE') {
    const sql = `WITH d AS (DELETE FROM public.${identifier(table)} t${where(filters(search, 't', params))} RETURNING t.*) SELECT coalesce(jsonb_agg(d),'[]'::jsonb) AS body FROM d`;
    const rows = (await tx.query(sql, params)).rows[0].body;
    return returning ? { status: 200, body: rows } : { status: 204, body: null };
  }
  throw httpError(405, 'PGRST117', `Unsupported method ${method}`);
}

async function rpc(tx, schema, name, args) {
  const candidates = await schema.functionsNamed(tx, name);
  const given = Object.keys(args);
  const match = candidates.find(fn => {
    const names = (fn.names ?? []).slice(0, fn.count);
    const required = names.slice(0, fn.count - fn.defaults);
    return given.every(key => names.includes(key)) && required.every(key => given.includes(key));
  });
  if (!match) throw httpError(404, 'PGRST202', `Could not find the function public.${name}(${given.join(', ')}) in the schema cache`);
  const params = [];
  const call = `public.${identifier(name)}(${given.map(key => `${identifier(key)} => ${bind(params, args[key], match.types[match.names.indexOf(key)])}`).join(', ')})`;
  if (match.returns === 'void') { await tx.query(`SELECT ${call}`, params); return { status: 204, body: null }; }
  if (match.returns_set) return { status: 200, body: (await tx.query(`SELECT coalesce(jsonb_agg(r),'[]'::jsonb) AS body FROM ${call} r`, params)).rows[0].body };
  if (match.return_kind === 'c' || match.returns === 'record') return { status: 200, body: (await tx.query(`SELECT to_jsonb(r) AS body FROM ${call} r`, params)).rows[0]?.body ?? null };
  return { status: 200, body: (await tx.query(`SELECT to_jsonb(${call}) AS body`, params)).rows[0].body };
}

// PostgREST's mapping from SQLSTATE to HTTP status, for the codes the app's database raises.
function failure(error, role) {
  if (error.status) return error;
  const code = error.code ?? 'XX000';
  const status = code === '42501' ? (role === 'anon' ? 401 : 403) : ['23503', '23505'].includes(code) ? 409 : code === '42883' ? 404
    : /^(P0|22|23|42P|2F|42804|42703|55)/.test(code) ? 400 : code === '40001' ? 409 : 500;
  return { status, body: { code, message: error.message, details: error.detail ?? null, hint: error.hint ?? null } };
}

export async function startFakeSupabase({ port = 54330, db, origin = `http://127.0.0.1:${port}`, anonKey = defaultAnonKey, serviceKey = defaultServiceKey } = {}) {
  let database = db ?? await createDatabase();
  let schema = catalog();
  let snapshot = null;
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const kid = 'e2e-' + crypto.randomUUID();
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' };
  const issuer = origin + '/auth/v1';
  const users = new Map();
  const refresh = new Map();
  const sign = user => {
    const head = base64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid }));
    const body = base64url(JSON.stringify({ iss: issuer, aud: 'authenticated', role: 'authenticated', sub: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) + 3600 }));
    return `${head}.${body}.${base64url(crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }))}`;
  };
  const verify = token => {
    try {
      const [head, body, signature] = token.split('.');
      if (!crypto.verify('sha256', Buffer.from(`${head}.${body}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'))) return null;
      const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
      return claims.exp > Date.now() / 1000 ? claims : null;
    } catch { return null; }
  };
  const publicUser = user => ({ id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: { full_name: user.name }, created_at: '2026-01-01T00:00:00Z' });
  const session = user => { const token = crypto.randomUUID(); refresh.set(token, user); return { access_token: sign(user), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: token, user: publicUser(user) }; };
  // One request at a time: PGlite is a single connection, and each request is its own transaction.
  let queue = Promise.resolve();
  const serial = work => { const run = queue.then(work, work); queue = run.catch(() => {}); return run; };

  /** Runs `work` in a transaction as the caller the JWT claims describe, the way PostgREST does. */
  async function asClaims(claims, headers, work) {
    const role = claims?.role ?? 'anon';
    return serial(() => database.transaction(async tx => {
      await tx.query(`SELECT set_config('request.jwt.claims',$1,true), set_config('request.jwt.claim.sub',$2,true), set_config('request.headers',$3,true)`,
        [JSON.stringify(claims ?? { role: 'anon' }), claims?.sub ?? '', JSON.stringify(Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)])))]);
      await tx.exec(`SET LOCAL ROLE ${role}`);
      return work(tx, role);
    }));
  }

  async function asCaller(headers, work) {
    const bearer = headers.authorization?.replace(/^Bearer /i, '');
    // supabase-js sends the anon key as the bearer while signed out.
    const claims = bearer === serviceKey || headers.apikey === serviceKey ? { role: 'service_role' } : bearer && bearer !== anonKey ? verify(bearer) : null;
    if (bearer && bearer !== anonKey && !claims) throw httpError(401, 'PGRST301', 'JWT expired or invalid');
    return asClaims(claims, headers, work);
  }

  async function auth(path, search, method, headers, body) {
    if (path === '/auth/v1/.well-known/jwks.json') return { status: 200, body: { keys: [jwk] } };
    if (path === '/auth/v1/token' && method === 'POST') {
      if (search.get('grant_type') === 'password') {
        const user = users.get(String(body?.email ?? '').toLowerCase());
        if (!user || user.password !== body?.password) return { status: 400, body: { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials' } };
        return { status: 200, body: session(user) };
      }
      if (search.get('grant_type') === 'refresh_token') {
        const user = refresh.get(body?.refresh_token);
        return user ? { status: 200, body: session(user) } : { status: 400, body: { error: 'invalid_grant' } };
      }
    }
    if (path === '/auth/v1/user') {
      const claims = verify(headers.authorization?.replace(/^Bearer /i, '') ?? '');
      const user = claims && [...users.values()].find(item => item.id === claims.sub);
      return user ? { status: 200, body: publicUser(user) } : { status: 401, body: { message: 'Invalid token', code: 'bad_jwt' } };
    }
    if (path === '/auth/v1/logout') return { status: 204, body: null };
    return { status: 404, body: { message: `The test server does not offer ${method} ${path}` } };
  }

  /** Adds a person who can sign in with this email and password; the app's handle_new_user trigger creates their profile. */
  async function addUser({ email, password, id = crypto.randomUUID(), name = email }) {
    await serial(() => database.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)', [id, email, JSON.stringify({ full_name: name })]));
    users.set(email.toLowerCase(), { id, email, password, name });
    return id;
  }

  // The browser calls this origin directly from the app's origin, so every reply carries CORS headers.
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,HEAD,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': '*', 'Access-Control-Expose-Headers': 'Content-Range' };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString();
    let reply;
    try {
      const body = text ? JSON.parse(text) : null;
      const headers = Object.fromEntries(Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : value]));
      if (url.pathname === '/__snapshot' && req.method === 'POST') { snapshot = await serial(() => database.dumpDataDir('none')); reply = { status: 204, body: null }; }
      else if (url.pathname === '/__reset' && req.method === 'POST') {
        if (!snapshot) throw httpError(409, 'E2E', 'No snapshot was taken.');
        await serial(async () => { await database.close(); database = new PGlite({ loadDataDir: snapshot }); await database.waitReady; schema = catalog(); });
        reply = { status: 204, body: null };
      }
      else if (url.pathname.startsWith('/auth/v1/')) reply = await auth(url.pathname, url.searchParams, req.method, headers, body);
      else if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const name = url.pathname.slice('/rest/v1/rpc/'.length);
        const args = req.method === 'GET' ? Object.fromEntries(url.searchParams) : (body ?? {});
        reply = await asCaller(headers, tx => rpc(tx, schema, name, args)).catch(error => failure(error, headers.authorization && !headers.authorization.endsWith(anonKey) ? 'authenticated' : 'anon'));
      } else if (url.pathname.startsWith('/rest/v1/')) {
        const table = url.pathname.slice('/rest/v1/'.length);
        reply = await asCaller(headers, tx => rest(tx, schema, { method: req.method, table, search: url.searchParams, body, prefer: headers.prefer ?? '', headers }))
          .catch(error => failure(error, headers.authorization && !headers.authorization.endsWith(anonKey) ? 'authenticated' : 'anon'));
      } else reply = { status: 404, body: { message: `The test server does not offer ${req.method} ${url.pathname}` } };
    } catch (error) { reply = failure(error, 'anon'); }
    // Refusals the app expects (a 401 for a signed-out read, a 403 for a viewer write) are normal; the log helps when a test fails.
    if (reply.status >= 400) console.error(`[test supabase] ${req.method} ${url.pathname}${url.search} → ${reply.status} ${reply.body?.message ?? ''}`);
    res.writeHead(reply.status, { 'Content-Type': 'application/json', ...cors, ...(reply.headers ?? {}) });
    res.end(reply.body === null || reply.body === undefined ? '' : JSON.stringify(reply.body));
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return {
    url: origin,
    serviceKey,
    addUser,
    /** Superuser SQL, outside any role: for seeding. */
    query: (sql, params) => serial(() => database.query(sql, params)),
    /** `work(tx)` as a signed-in member, through the app's own RLS and functions: for seeding through the real RPCs. */
    asUser: (user, work) => asClaims({ role: 'authenticated', sub: user.id, email: user.email, aud: 'authenticated' }, {}, work),
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

// `node e2e/fake-supabase.mjs` serves it for the Playwright web server, seeded with e2e/fixture.mjs.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { seed } = await import('./fixture.mjs');
  const port = Number(process.env.E2E_SUPABASE_PORT ?? 54330);
  const fake = await startFakeSupabase({ port });
  await seed(fake);
  console.log(`Test Supabase ready at ${fake.url}`);
}
