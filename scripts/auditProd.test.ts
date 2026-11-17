import { describe, expect, it } from 'vitest';
import { ACCEPTED_ADVISORIES, classifyAdvisories } from './audit-prod.mjs';

const advisory = (name: string, severity: string, ghsa: string, title = `${name} flaw`) => (
  { name, severity, title, url: `https://github.com/advisories/${ghsa}`, range: '*' }
);

describe('classifyAdvisories', () => {
  it('blocks a high or critical advisory and ignores lower ones', () => {
    const { blocking, accepted } = classifyAdvisories({
      vulnerabilities: {
        leftpad: { severity: 'high', via: [advisory('leftpad', 'high', 'GHSA-aaaa-bbbb-cccc')] },
        rce: { severity: 'critical', via: [advisory('rce', 'critical', 'GHSA-1111-2222-3333')] },
        uuid: { severity: 'moderate', via: [advisory('uuid', 'moderate', 'GHSA-w5hq-g745-h8pq')] },
      },
    }, {});
    expect(blocking.map((item: { id: string }) => item.id)).toEqual(['GHSA-aaaa-bbbb-cccc', 'GHSA-1111-2222-3333']);
    expect(accepted).toEqual([]);
  });

  it('lets an accepted advisory through, with the packages that only depend on it', () => {
    const report = {
      vulnerabilities: {
        picomatch: { severity: 'high', via: [advisory('picomatch', 'high', 'GHSA-fc5q-39xc-vjpf')] },
        // Flagged only for depending on picomatch: no advisory of its own.
        '@parcel/watcher': { severity: 'high', via: ['picomatch'] },
      },
    };
    const { blocking, accepted } = classifyAdvisories(report);
    expect(blocking).toEqual([]);
    expect(accepted.map((item: { id: string }) => item.id)).toEqual(['GHSA-fc5q-39xc-vjpf']);
  });

  it('still blocks another advisory in the same package as an accepted one', () => {
    const { blocking } = classifyAdvisories({
      vulnerabilities: {
        picomatch: { severity: 'high', via: [
          advisory('picomatch', 'high', 'GHSA-fc5q-39xc-vjpf'),
          advisory('picomatch', 'high', 'GHSA-9999-8888-7777', 'another flaw'),
        ] },
      },
    });
    expect(blocking.map((item: { id: string }) => item.id)).toEqual(['GHSA-9999-8888-7777']);
  });

  it('blocks an advisory it cannot identify, and reports each one once', () => {
    const anonymous = { name: 'odd', severity: 'high', title: 'no url', url: '' };
    const repeated = advisory('dup', 'high', 'GHSA-aaaa-bbbb-cccc');
    const { blocking } = classifyAdvisories({
      vulnerabilities: { odd: { via: [anonymous] }, a: { via: [repeated] }, b: { via: [repeated] } },
    }, { '': 'never matches' });
    expect(blocking).toHaveLength(2);
  });

  it('accepts only advisories with a written reason', () => {
    for (const [id, reason] of Object.entries(ACCEPTED_ADVISORIES)) {
      expect(id).toMatch(/^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/);
      expect(String(reason).length).toBeGreaterThan(20);
    }
    expect(classifyAdvisories({}).blocking).toEqual([]);
  });
});
