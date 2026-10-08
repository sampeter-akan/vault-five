import { writeFileSync, appendFileSync } from 'node:fs';

const targets = [
  { name: 'Frontend', url: 'https://vault-five-umber.vercel.app/', expected: [200], checkHtml: true },
  { name: 'Protected game API', url: 'https://jbjgnabbostmdsqdrkus.supabase.co/functions/v1/game', expected: [401, 403] },
];
const rows = [];
let failed = false;
for (const target of targets) {
  const start = performance.now();
  let status = 'network-error', ok = false, detail = '';
  try {
    const response = await fetch(target.url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'vault-five-synthetic-check/1.0' } });
    status = response.status;
    ok = target.expected.includes(response.status);
    if (target.checkHtml && ok) {
      const html = await response.text();
      ok = /<html[^>]*>/i.test(html) && /vault five/i.test(html);
      if (!ok) detail = 'HTML signature missing';
    }
    if (!ok && !detail) detail = 'Unexpected HTTP response';
  } catch (error) { detail = error instanceof Error ? error.name : 'Request failed'; }
  const durationMs = Math.round(performance.now() - start);
  if (!ok) failed = true;
  rows.push({ target: target.name, status, durationMs, result: ok ? 'PASS' : 'FAIL', detail });
  console.log(JSON.stringify(rows.at(-1)));
}
const markdown = ['## VAULT FIVE production synthetic check', '', '| Target | HTTP | Duration (ms) | Result |', '|---|---:|---:|---|', ...rows.map(r => `| ${r.target} | ${r.status} | ${r.durationMs} | ${r.result} |`), '', 'Checks are non-mutating. The protected API is expected to reject an unauthenticated request; this does not prove authenticated gameplay works.', 'Durations are individual external probes, not p95 or application-wide latency.'].join('\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + '\n');
writeFileSync('synthetic-results.json', JSON.stringify({ checkedAt: new Date().toISOString(), results: rows }, null, 2) + '\n');
if (failed) process.exitCode = 1;
