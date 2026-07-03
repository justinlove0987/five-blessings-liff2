const assert = require('node:assert/strict');
const {
  buildHistoryDateLabel,
  getCurrentTaskPeriods,
  getHistoryPeriods
} = require('../api/_shared');

const julyThird = new Date('2026-07-03T04:00:00Z');
const julyFourth = new Date('2026-07-04T04:00:00Z');

assert.equal(
  getCurrentTaskPeriods(julyThird).sunday.periodKey,
  '2026-06-27'
);

assert.equal(
  buildHistoryDateLabel('sunday', '2026-06-27'),
  '6/27（六） - 7/3（五）'
);

assert.equal(
  getCurrentTaskPeriods(julyFourth).sunday.periodKey,
  '2026-07-04'
);

assert.deepEqual(
  getHistoryPeriods(2026, 7, 'sunday', { year: 2026, month: 7, day: 3 }).map(period => period.periodKey),
  []
);

assert.deepEqual(
  getHistoryPeriods(2026, 6, 'sunday', { year: 2026, month: 7, day: 3 }).map(period => period.periodKey),
  ['2026-06-27', '2026-06-20', '2026-06-13', '2026-06-06']
);

console.log('sunday period tests passed');
