const assert = require('node:assert/strict');
const {
  buildHistoryDateLabel,
  getCurrentTaskPeriods,
  getHistoryPeriods,
  getLeaderboardMonthPeriods,
  selectCurrentMonthlyOccurrencePeriod
} = require('../api/_shared');

const julyThird = new Date('2026-07-03T04:00:00Z');

assert.equal(
  getCurrentTaskPeriods(julyThird).sunday.periodKey,
  '2026-07#1'
);

assert.equal(
  buildHistoryDateLabel('sunday', '2026-07#4'),
  '7月第4次'
);

assert.deepEqual(
  getHistoryPeriods(2026, 7, 'sunday', { year: 2026, month: 7, day: 3 }).map(period => period.periodKey),
  ['2026-07#1', '2026-07#2', '2026-07#3', '2026-07#4']
);

assert.deepEqual(
  getLeaderboardMonthPeriods(2026, 7, { year: 2026, month: 7, day: 3 })
    .filter(period => period.blessingType === 'sunday')
    .map(period => period.periodKey),
  ['2026-07#1', '2026-07#2', '2026-07#3', '2026-07#4']
);

assert.equal(
  selectCurrentMonthlyOccurrencePeriod('sunday', new Set(), julyThird).periodKey,
  '2026-07#1'
);

assert.equal(
  selectCurrentMonthlyOccurrencePeriod('sunday', new Set(['2026-07#1']), julyThird).periodKey,
  '2026-07#2'
);

assert.equal(
  selectCurrentMonthlyOccurrencePeriod('sunday', new Set(['2026-07#1', '2026-07#2', '2026-07#3']), julyThird).periodKey,
  '2026-07#4'
);

assert.equal(
  selectCurrentMonthlyOccurrencePeriod('sunday', new Set(['2026-07#1', '2026-07#2', '2026-07#3', '2026-07#4']), julyThird).periodKey,
  '2026-07#4'
);

console.log('sunday period tests passed');
