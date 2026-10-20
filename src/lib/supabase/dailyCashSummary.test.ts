import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';
import { loadDailyCashSummary } from './dailyCashSummary';
import { calculateFinancialReportTotals } from '../calculations/dailyReport';
import { canReadFinancialTotals } from '../permissions';

function database(failTable?: string) {
  const requests: Array<{table: string; filters: Record<string,string>; from: number}> = [];
  const db = { from(table: string) {
    const filters: Record<string,string> = {};
    const query = {
      select() { return query; },
      eq(key: string,value: string) { filters[key]=value; return query; },
      order() { return query; },
      async range(from: number,to: number) {
        requests.push({table,filters,from});
        if(table===failTable) return {data:null,error:{message:'read failed'}};
        const rows = table === 'daily_stock_counts' ? [{bar_income:'300000',bar_cost:'100000'}]
          : table === 'expenses' ? [
            ...Array.from({length:1000},()=>({amount:'100',payment_source:'game_club'})),
            {amount:'50000',payment_source:'bar'}, // salary payment beyond the first page
          ] : [{amount:'20000'}];
        return {data:rows.slice(from,to+1),error:null};
      },
    };return query;
  }} as unknown as SupabaseClient;
  return {db,requests};
}
it('includes all expenses, salary payments and new debt principal in each side\'s daily profit',async()=>{
  const {db,requests}=database();
  const summary=await loadDailyCashSummary(db,'club-a','2026-09-26',true);
  const totals=calculateFinancialReportTotals({...summary,manualIncome:1000000});
  expect(totals).toMatchObject({gameClubExpenses:100000,barExpenses:50000,debtIncome:20000,gameClubProfit:920000,barProfit:150000});
  expect(requests.some(r=>r.table==='expenses' && r.from===1000)).toBe(true);
  expect(requests.every(r=>r.filters.club_id==='club-a' && r.filters.date==='2026-09-26')).toBe(true);
  expect(requests.some(r=>r.table==='debt_payments')).toBe(false);
});
it('does not request profit inputs for restricted daily-cash users',async()=>{
  const {db,requests}=database();
  const canSeeProfit=canReadFinancialTotals('admin',['daily_cash']);
  expect(canSeeProfit).toBe(false);
  await loadDailyCashSummary(db,'club-a','2026-09-26',canSeeProfit);
  expect(requests.map(r=>r.table)).toEqual(['daily_stock_counts']);
  expect(canReadFinancialTotals('admin',['daily_cash','expenses'])).toBe(false);
  for(const role of ['owner','admin','viewer'] as const) expect(canReadFinancialTotals(role,null)).toBe(true);
  for(const feature of ['dashboard','reports','owner_profit']) expect(canReadFinancialTotals('admin',[feature])).toBe(true);
});
it.each(['expenses','new_debts','daily_stock_counts'])('does not silently show incomplete profit if %s fails',async(table)=>{
  await expect(loadDailyCashSummary(database(table).db,'club-a','2026-09-26',true)).rejects.toThrow('read failed');
});
