const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = fs.readFileSync(require.resolve('../src/lib/pay-period.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const mod = { exports: {} };
new Function('exports', compiled.outputText)(mod.exports);
const { payrollPeriod, runningPayMonth } = mod.exports;

assert.deepEqual(payrollPeriod('2026-09'), { from: '2026-08-15', to: '2026-09-14' });
assert.deepEqual(payrollPeriod('2027-01'), { from: '2026-12-15', to: '2027-01-14' });
assert.deepEqual(payrollPeriod('2028-03'), { from: '2028-02-15', to: '2028-03-14' });

// Boundary trips belong to exactly one payroll, including leap day.
for (const [month, dates] of [
  ['2026-09', ['2026-08-14', '2026-08-15', '2026-09-14', '2026-09-15']],
  ['2028-03', ['2028-02-14', '2028-02-15', '2028-02-29', '2028-03-14', '2028-03-15']],
]) {
  const { from, to } = payrollPeriod(month);
  assert.deepEqual(dates.filter(date => date >= from && date <= to), dates.slice(1, -1));
}
// The running period: from the 15th it is next month's, across a year end too.
assert.equal(runningPayMonth('2026-11-14'), '2026-11');
assert.equal(runningPayMonth('2026-11-15'), '2026-12');
assert.equal(runningPayMonth('2026-12-17'), '2027-01');
for (const d of ['2026-11-01', '2026-11-14', '2026-11-15', '2026-11-30', '2026-12-31']) {
  const { from, to } = payrollPeriod(runningPayMonth(d));
  assert.ok(d >= from && d <= to, d);
}
console.log('Payroll periods: September, year rollover, leap year and inclusive boundaries passed.');
