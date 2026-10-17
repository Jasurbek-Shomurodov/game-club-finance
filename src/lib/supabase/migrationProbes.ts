import { createHash } from 'node:crypto';

/**
 * Build-time only: derives, from the committed migration files, schema objects whose
 * presence proves a specific migration ran. The result is written to
 * migrationManifest.json by scripts/generate-migration-manifest.ts; the app reads that
 * JSON and never imports this module.
 *
 * A probe is attributed to a migration only when that migration is the sole creator of
 * the object and no later migration drops it, so its presence cannot come from any other
 * file. A function redefined across migrations is probed by its body hash in the last
 * migration that defines it, when that body differs from every earlier definition.
 */
export type Probe =
  | { kind: 'relation'; name: string }
  | { kind: 'type'; name: string }
  | { kind: 'enumValue'; type: string; value: string }
  | { kind: 'column'; table: string; column: string }
  | { kind: 'constraint'; table: string; name: string }
  | { kind: 'policy'; table: string; name: string }
  | { kind: 'trigger'; table: string; name: string }
  | { kind: 'function'; signature: string }
  | { kind: 'functionBody'; signature: string; md5: string };

export interface MigrationEntry {
  file: string;
  probes: Probe[];
}

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][\w$]*)`;
const QNAME = String.raw`${IDENT}(?:\s*\.\s*${IDENT})?`;
const re = (source: string) => new RegExp(source, 'i');

/** Splits SQL into statements, dropping comments and keeping quoted text verbatim. */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      current += ' ';
      continue;
    }
    if (rest.startsWith('/*')) {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      current += ' ';
      continue;
    }
    const dollar = /^\$[A-Za-z_]*\$/.exec(rest);
    if (dollar) {
      const end = sql.indexOf(dollar[0], i + dollar[0].length);
      const stop = end === -1 ? sql.length : end + dollar[0].length;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }
    const quote = sql[i];
    if (quote === "'" || quote === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === quote && sql[j + 1] === quote) j += 2;
        else if (sql[j] === quote) break;
        else j += 1;
      }
      current += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (quote === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
    } else {
      current += quote;
    }
    i += 1;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

/** Splits on commas outside parentheses and quotes. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

/** Text inside the parenthesis opening at `open`, or null when unbalanced. */
function balanced(text: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')' && --depth === 0) return text.slice(open + 1, i);
  }
  return null;
}

function ident(part: string): string {
  return part.startsWith('"') ? part.slice(1, -1) : part.toLowerCase();
}

/** `schema.name` with public as the default schema. */
function qualify(name: string): string {
  const parts = name.match(new RegExp(IDENT, 'g'))!.map(ident);
  return parts.length === 1 ? `public.${parts[0]}` : `${parts[0]}.${parts[1]}`;
}

const TYPE_ALIASES: Record<string, string> = {
  int: 'integer', int4: 'integer', int8: 'bigint', int2: 'smallint', bool: 'boolean',
  timestamptz: 'timestamp with time zone', timestamp: 'timestamp without time zone',
  varchar: 'character varying', decimal: 'numeric', float8: 'double precision',
};
const MULTIWORD_TYPE = /^(double precision|character varying|bit varying|(?:timestamp|time)(?:\s*\(\d+\))?\s+with(?:out)?\s+time\s+zone)(\s*\[\])*$/i;

/** One argument's type in a form `to_regprocedure` accepts, or null for OUT arguments. */
function argumentType(arg: string): string | null {
  let text = arg.split(/\s+default\s+|\s*=\s*/i)[0].trim();
  const mode = /^(in|out|inout|variadic)\s+/i.exec(text);
  if (mode) {
    if (mode[1].toLowerCase() === 'out') return null;
    text = text.slice(mode[0].length);
  }
  const single = /^[\w."]+(\s*\([^)]*\))?(\s*\[\])*$/.test(text);
  const type = single || MULTIWORD_TYPE.test(text) ? text : text.replace(/^\S+\s+/, '');
  const array = (type.match(/\[\]/g) ?? []).join('');
  const base = type.replace(/\s*\[\]/g, '').replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').toLowerCase()
    .replace(/^public\./, '');
  return (TYPE_ALIASES[base] ?? base) + array;
}

function signature(name: string, args: string): string {
  const types = splitTopLevel(args).map(argumentType).filter((type): type is string => type !== null);
  return `${qualify(name)}(${types.join(',')})`;
}

const md5 = (text: string) => createHash('md5').update(text).digest('hex');

type ObjectEvent = { key: string; probe: Probe; table?: string; migration: number; op: 'create' | 'drop' };
type FunctionEvent = { signature: string; name: string; migration: number; op: 'create' | 'drop'; body?: string };

class Recorder {
  objects: ObjectEvent[] = [];
  functions: FunctionEvent[] = [];
  /** Inside a DO block only removals count: its creations may be conditional. */
  dropsOnly = false;
  constructor(public migration: number) {}

  object(op: 'create' | 'drop', probe: Probe) {
    if (this.dropsOnly && op === 'create') return;
    const table = 'table' in probe ? probe.table : undefined;
    this.objects.push({ key: JSON.stringify(probe), probe, table, migration: this.migration, op });
  }
  relation(op: 'create' | 'drop', name: string) { this.object(op, { kind: 'relation', name }); }
}

function recordCreateTable(r: Recorder, table: string, body: string) {
  r.relation('create', table);
  for (const item of splitTopLevel(body)) {
    for (const match of item.matchAll(new RegExp(String.raw`\bconstraint\s+(${IDENT})`, 'gi'))) {
      r.object('create', { kind: 'constraint', table, name: ident(match[1]) });
    }
    if (/^(constraint|primary|unique|check|foreign|exclude|like)\b/i.test(item)) continue;
    const column = re(`^(${IDENT})`).exec(item);
    if (column) r.object('create', { kind: 'column', table, column: ident(column[1]) });
  }
}

function recordAlterTable(r: Recorder, table: string, actions: string) {
  if (/^rename\s+to\s+/i.test(actions)) {
    r.relation('drop', table);
    return;
  }
  for (const action of splitTopLevel(actions)) {
    let m: RegExpExecArray | null;
    if ((m = re(String.raw`^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?(${IDENT})`).exec(action))
      && !/^add\s+(constraint|primary|unique|check|foreign|exclude)\b/i.test(action)) {
      r.object('create', { kind: 'column', table, column: ident(m[1]) });
      for (const c of action.matchAll(new RegExp(String.raw`\bconstraint\s+(${IDENT})`, 'gi'))) {
        r.object('create', { kind: 'constraint', table, name: ident(c[1]) });
      }
    } else if ((m = re(String.raw`^add\s+constraint\s+(${IDENT})`).exec(action))) {
      r.object('create', { kind: 'constraint', table, name: ident(m[1]) });
    } else if ((m = re(String.raw`^drop\s+(?:column\s+)?(?:if\s+exists\s+)?(${IDENT})`).exec(action))
      && !/^drop\s+(constraint|default|not|identity|expression)\b/i.test(action)) {
      r.object('drop', { kind: 'column', table, column: ident(m[1]) });
    } else if ((m = re(String.raw`^drop\s+constraint\s+(?:if\s+exists\s+)?(${IDENT})`).exec(action))) {
      r.object('drop', { kind: 'constraint', table, name: ident(m[1]) });
    } else if ((m = re(String.raw`^rename\s+constraint\s+(${IDENT})\s+to\s+(${IDENT})`).exec(action))) {
      r.object('drop', { kind: 'constraint', table, name: ident(m[1]) });
      r.object('create', { kind: 'constraint', table, name: ident(m[2]) });
    } else if ((m = re(String.raw`^rename\s+(?:column\s+)?(${IDENT})\s+to\s+(${IDENT})`).exec(action))) {
      r.object('drop', { kind: 'column', table, column: ident(m[1]) });
      r.object('create', { kind: 'column', table, column: ident(m[2]) });
    }
  }
}

function recordStatement(r: Recorder, statement: string) {
  let m: RegExpExecArray | null;
  if (/^do\b/i.test(statement)) {
    recordDoBlockRemovals(r, statement);
    return;
  }

  if ((m = re(String.raw`^create\s+(?:or\s+replace\s+)?function\s+(${QNAME})\s*\(`).exec(statement))) {
    const args = balanced(statement, m[0].length - 1) ?? '';
    const tag = /\bas\s+(\$[A-Za-z_]*\$)/i.exec(statement.slice(m[0].length + args.length));
    const bodyStart = tag ? statement.indexOf(tag[1], m[0].length + args.length) + tag[1].length : -1;
    const body = tag ? statement.slice(bodyStart, statement.indexOf(tag[1], bodyStart)) : undefined;
    r.functions.push({ signature: signature(m[1], args), name: qualify(m[1]), migration: r.migration, op: 'create', body });
    return;
  }
  if ((m = /^drop\s+function\s+(?:if\s+exists\s+)?([\s\S]*?)(?:\s+(?:cascade|restrict))?$/i.exec(statement))) {
    for (const target of splitTopLevel(m[1])) {
      const fn = re(String.raw`^(${QNAME})\s*(?:\(([\s\S]*)\))?$`).exec(target);
      if (!fn) continue;
      r.functions.push({ signature: fn[2] === undefined ? '' : signature(fn[1], fn[2]), name: qualify(fn[1]), migration: r.migration, op: 'drop' });
    }
    return;
  }
  if ((m = re(String.raw`^alter\s+function\s+(${QNAME})\s*\(`).exec(statement))) {
    const args = balanced(statement, m[0].length - 1) ?? '';
    if (/\brename\s+to\b/i.test(statement.slice(m[0].length + args.length))) {
      r.functions.push({ signature: signature(m[1], args), name: qualify(m[1]), migration: r.migration, op: 'drop' });
    }
    return;
  }
  if ((m = re(String.raw`^create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(${QNAME})\s*\(`).exec(statement))) {
    recordCreateTable(r, qualify(m[1]), balanced(statement, m[0].length - 1) ?? '');
    return;
  }
  if ((m = re(String.raw`^create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?(${QNAME})`).exec(statement))) {
    r.relation('create', qualify(m[1]));
    return;
  }
  if ((m = re(String.raw`^create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?(${IDENT})\s+on\s+(?:only\s+)?(${QNAME})`).exec(statement))) {
    const table = qualify(m[2]);
    r.objects.push({ ...indexEvent(table, m[1]), migration: r.migration, op: 'create' });
    return;
  }
  if ((m = /^drop\s+(index|table|view|materialized\s+view|type)\s+(?:concurrently\s+)?(?:if\s+exists\s+)?([\s\S]*?)(?:\s+(?:cascade|restrict))?$/i.exec(statement))) {
    const kind = m[1].toLowerCase();
    for (const target of splitTopLevel(m[2])) {
      const name = qualify(target);
      if (kind === 'type') r.object('drop', { kind: 'type', name });
      else if (kind === 'index') r.objects.push({ key: indexKey(name), probe: { kind: 'relation', name }, migration: r.migration, op: 'drop' });
      else r.relation('drop', name);
    }
    return;
  }
  if ((m = re(String.raw`^create\s+type\s+(${QNAME})\s+as\s+enum\s*\(([\s\S]*)\)$`).exec(statement))) {
    const type = qualify(m[1]);
    r.object('create', { kind: 'type', name: type });
    for (const value of m[2].matchAll(/'((?:[^']|'')*)'/g)) r.object('create', { kind: 'enumValue', type, value: value[1] });
    return;
  }
  if ((m = re(String.raw`^create\s+type\s+(${QNAME})`).exec(statement))) {
    r.object('create', { kind: 'type', name: qualify(m[1]) });
    return;
  }
  if ((m = re(String.raw`^alter\s+type\s+(${QNAME})\s+add\s+value\s+(?:if\s+not\s+exists\s+)?'((?:[^']|'')*)'`).exec(statement))) {
    r.object('create', { kind: 'enumValue', type: qualify(m[1]), value: m[2] });
    return;
  }
  if ((m = re(String.raw`^alter\s+type\s+(${QNAME})\s+rename\s+value\s+'((?:[^']|'')*)'\s+to\s+'((?:[^']|'')*)'`).exec(statement))) {
    r.object('drop', { kind: 'enumValue', type: qualify(m[1]), value: m[2] });
    r.object('create', { kind: 'enumValue', type: qualify(m[1]), value: m[3] });
    return;
  }
  if ((m = re(String.raw`^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(${QNAME})\s+([\s\S]*)$`).exec(statement))) {
    recordAlterTable(r, qualify(m[1]), m[2]);
    return;
  }
  if ((m = re(String.raw`^create\s+policy\s+(${IDENT})\s+on\s+(${QNAME})`).exec(statement))) {
    r.object('create', { kind: 'policy', table: qualify(m[2]), name: ident(m[1]) });
    return;
  }
  if ((m = re(String.raw`^drop\s+policy\s+(?:if\s+exists\s+)?(${IDENT})\s+on\s+(${QNAME})`).exec(statement))) {
    r.object('drop', { kind: 'policy', table: qualify(m[2]), name: ident(m[1]) });
    return;
  }
  if ((m = re(String.raw`^alter\s+policy\s+(${IDENT})\s+on\s+(${QNAME})\s+rename\s+to\s+(${IDENT})`).exec(statement))) {
    r.object('drop', { kind: 'policy', table: qualify(m[2]), name: ident(m[1]) });
    r.object('create', { kind: 'policy', table: qualify(m[2]), name: ident(m[3]) });
    return;
  }
  if ((m = re(String.raw`^create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+(${IDENT})\s[\s\S]*?\bon\s+(${QNAME})`).exec(statement))) {
    r.object('create', { kind: 'trigger', table: qualify(m[2]), name: ident(m[1]) });
    return;
  }
  if ((m = re(String.raw`^drop\s+trigger\s+(?:if\s+exists\s+)?(${IDENT})\s+on\s+(${QNAME})`).exec(statement))) {
    r.object('drop', { kind: 'trigger', table: qualify(m[2]), name: ident(m[1]) });
  }
}

/** Records what a DO block may remove, so a conditional drop still disqualifies a probe. */
function recordDoBlockRemovals(r: Recorder, block: string) {
  const starts = /\b(?:alter\s+type|alter\s+table|alter\s+function|alter\s+policy|drop\s+(?:policy|trigger|function|index|table|view|type))\b/gi;
  r.dropsOnly = true;
  for (const match of block.matchAll(starts)) {
    const end = block.indexOf(';', match.index);
    recordStatement(r, block.slice(match.index, end === -1 ? undefined : end).trim());
  }
  r.dropsOnly = false;
}

/** Indexes are keyed by name alone (a drop does not name the table) but remember their table. */
const indexKey = (name: string) => `index:${name}`;
function indexEvent(table: string, index: string) {
  const name = `${table.split('.')[0]}.${ident(index)}`;
  return { key: indexKey(name), probe: { kind: 'relation', name } as Probe, table };
}

/** Probes for every migration, in file order. `sources` must be sorted by filename. */
export function buildMigrationManifest(sources: readonly { file: string; sql: string }[]): MigrationEntry[] {
  const recorders = sources.map((source, index) => {
    const r = new Recorder(index);
    for (const statement of splitStatements(source.sql)) recordStatement(r, statement);
    return r;
  });
  const objects = recorders.flatMap((r) => r.objects);
  const functions = recorders.flatMap((r) => r.functions);
  const probes: Probe[][] = sources.map(() => []);

  const tableDrops = new Map<string, number[]>();
  for (const event of objects) {
    if (event.op === 'drop' && event.probe.kind === 'relation') {
      tableDrops.set(event.probe.name, [...(tableDrops.get(event.probe.name) ?? []), event.migration]);
    }
  }
  const byKey = new Map<string, ObjectEvent[]>();
  for (const event of objects) byKey.set(event.key, [...(byKey.get(event.key) ?? []), event]);
  for (const events of byKey.values()) {
    const last = events[events.length - 1];
    const creators = new Set(events.filter((e) => e.op === 'create').map((e) => e.migration));
    if (last.op !== 'create' || creators.size !== 1) continue;
    if (last.table && (tableDrops.get(last.table) ?? []).some((m) => m >= last.migration)) continue;
    probes[last.migration].push(last.probe);
  }

  const signatures = new Set(functions.filter((f) => f.op === 'create').map((f) => f.signature));
  for (const sig of signatures) {
    const events = functions.filter((f) => f.signature === sig
      || (f.op === 'drop' && f.signature === '' && sig.startsWith(`${f.name}(`)));
    const last = events[events.length - 1];
    if (last.op !== 'create' || last.body === undefined) continue;
    const others = events.filter((f) => f.op === 'create' && f.migration !== last.migration);
    if (others.length === 0) probes[last.migration].push({ kind: 'function', signature: sig });
    else if (others.every((f) => f.body === undefined || md5(f.body) !== md5(last.body!))) {
      probes[last.migration].push({ kind: 'functionBody', signature: sig, md5: md5(last.body) });
    }
  }

  return sources.map((source, index) => ({ file: source.file, probes: probes[index] }));
}
