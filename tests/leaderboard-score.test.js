const assert = require('node:assert/strict');
const { calculateTeamScore } = require('../api/leaderboard');

function round(value) {
  return Math.round(value * 1000000) / 1000000;
}

assert.equal(
  round(calculateTeamScore({
    memberCount: 3,
    weightedTotal: 180,
    userCompletionCounts: [25, 25, 25],
    maxWeightedTotalPerMember: 60,
    maxCompletionCountPerMember: 25
  })),
  1000
);

assert.equal(
  calculateTeamScore({
    memberCount: 0,
    weightedTotal: 180,
    userCompletionCounts: [],
    maxWeightedTotalPerMember: 60,
    maxCompletionCountPerMember: 25
  }),
  0
);

assert.equal(
  round(calculateTeamScore({
    memberCount: 3,
    weightedTotal: 999,
    userCompletionCounts: [30, 40, 50],
    maxWeightedTotalPerMember: 60,
    maxCompletionCountPerMember: 25
  })),
  1000
);

assert.equal(
  round(calculateTeamScore({
    memberCount: 2,
    weightedTotal: 60,
    userCompletionCounts: [25, 0],
    maxWeightedTotalPerMember: 60,
    maxCompletionCountPerMember: 25
  })),
  500
);

assert.equal(
  round(calculateTeamScore({
    memberCount: 2,
    weightedTotal: 0,
    userCompletionCounts: [25, 25, 25],
    maxWeightedTotalPerMember: 60,
    maxCompletionCountPerMember: 25
  })),
  100
);

assert.equal(
  round(calculateTeamScore({
    memberCount: 1,
    weightedTotal: 65,
    userCompletionCounts: [26],
    maxWeightedTotalPerMember: 65,
    maxCompletionCountPerMember: 26
  })),
  1000
);

console.log('leaderboard score tests passed');
