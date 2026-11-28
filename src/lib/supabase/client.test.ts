import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const capture = vi.hoisted(() => ({ fetch: undefined as typeof fetch | undefined }));
vi.mock('@supabase/ssr', () => ({ createBrowserClient: (_url: string, _key: string, options: { global: { fetch: typeof fetch } }) => {
  capture.fetch = options.global.fetch;
  return {};
} }));
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.test');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-test-key');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it.each(['POST', 'DELETE'])('refreshes report and payroll reads after an API %s including in-flight stale reads', async (method) => {
  let committed = false;
  let finishWrite!: () => void;
  let finishStale!: (response: Response) => void;
  let holdRead = false;
  const native = vi.fn(async (input: RequestInfo | URL) => {
    if (input === '/api/expenses') {
      await new Promise<void>(resolve => { finishWrite = resolve; });
      committed = true;
      return Response.json({ok:true});
    }
    if (holdRead) {
      holdRead = false;
      return new Promise<Response>(resolve => { finishStale = resolve; });
    }
    return Response.json({changed:committed});
  });
  vi.stubGlobal('window', { fetch: native });
  const {createClient,mutateFinanceRequest}=await import('./client');
  createClient();
  const read=(rpc='get_money_report_snapshot')=>capture.fetch!(`https://db.test/rest/v1/rpc/${rpc}`,{method:'POST',body:'{}'}).then(r=>r.json());
  expect(await read()).toEqual({changed:false});
  expect(await read('get_salary_profit_snapshot')).toEqual({changed:false});
  const write=mutateFinanceRequest('/api/expenses',{method});
  holdRead=true;
  const stale=read();
  await vi.waitFor(()=>expect(finishStale).toBeTypeOf('function'));
  finishWrite(); await write;
  expect(await read()).toEqual({changed:true});
  expect(await read('get_salary_profit_snapshot')).toEqual({changed:true});
  finishStale(Response.json({changed:false})); await stale;
  expect(await read()).toEqual({changed:true});
});
it('invalidates after a lost API response because the write may have committed',async()=>{
  let value=0;
  vi.stubGlobal('window',{fetch:async(input: RequestInfo | URL)=>{
    if(input==='/api/expenses'){value=1;throw new Error('connection lost');}
    return Response.json(value);
  }});
  const {createClient,mutateFinanceRequest}=await import('./client'); createClient();
  const read=()=>capture.fetch!('https://db.test/rest/v1/expenses').then(r=>r.json());
  expect(await read()).toBe(0);
  await expect(mutateFinanceRequest('/api/expenses',{method:'POST'})).rejects.toThrow('connection lost');
  expect(await read()).toBe(1);
});
it('reads again after invalidateReadCache, for data written outside the app',async()=>{
  let value=0;
  vi.stubGlobal('window',{fetch:async()=>Response.json(value)});
  const {createClient,invalidateReadCache}=await import('./client'); createClient();
  const read=()=>capture.fetch!('https://db.test/rest/v1/owner_telegram_links').then(r=>r.json());
  expect(await read()).toBe(0);
  value=1;
  expect(await read()).toBe(0);
  invalidateReadCache();
  expect(await read()).toBe(1);
});
