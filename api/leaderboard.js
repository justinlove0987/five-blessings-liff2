const {
  getLeaderboardMonthPeriods,
  getLeaderboardWeekPeriods,
  getSupabaseClient,
  getTaipeiDateParts,
  parseBody,
  sendError,
  sendJson,
  upsertLineUser,
  verifyLineIdToken
} = require('./_shared');

const MIN_LEADERBOARD_MEMBERS = 3;
const MAX_LEADERBOARD_MEMBERS = 6;
const TASK_WEIGHTS = {
  morningPrayer: 1,
  smallGroup: 5,
  sunday: 5,
  tithe: 20
};
const MAX_MONTHLY_COMPLETION_POINTS_PER_MEMBER = 60;
const MAX_MONTHLY_COMPLETION_COUNT_PER_MEMBER = 25;
const MAX_COMPLETION_SCORE = 900;
const MAX_PARTICIPATION_SCORE = 100;

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return sendJson(res, 405, {
        success: false,
        error: 'Method not allowed'
      });
    }

    const body = parseBody(req.body);
    const idToken = body.idToken;
    const range = body.range === 'week' ? 'week' : 'month';
    const today = getTaipeiDateParts(new Date());
    const year = clampYear(Number(body.year) || today.year);
    const month = clampMonth(Number(body.month) || today.month);

    if (!idToken) {
      return sendJson(res, 400, {
        success: false,
        error: 'Missing idToken'
      });
    }

    const lineProfile = await verifyLineIdToken(idToken);
    const supabase = getSupabaseClient();
    await upsertLineUser(supabase, lineProfile);

    const periods = range === 'week'
      ? getLeaderboardWeekPeriods()
      : getLeaderboardMonthPeriods(year, month, today);
    const leaderboard = await buildLeaderboard(supabase, periods);
    const winner = await buildMonthlyWinner(supabase, year, month, today);

    return sendJson(res, 200, {
      success: true,
      range,
      year,
      month,
      leaderboard: leaderboard.slice(0, 10),
      winner,
      periodLabel: range === 'week' ? '本週' : `${month}月`
    });
  } catch (error) {
    return sendError(res, error);
  }
};

function clampYear(year) {
  if (!Number.isFinite(year)) {
    return getTaipeiDateParts(new Date()).year;
  }

  return Math.min(2100, Math.max(2026, Math.trunc(year)));
}

function clampMonth(month) {
  if (!Number.isFinite(month)) {
    return getTaipeiDateParts(new Date()).month;
  }

  return Math.min(12, Math.max(1, Math.trunc(month)));
}

async function buildMonthlyWinner(supabase, year, month, today) {
  const rows = await buildLeaderboard(
    supabase,
    getLeaderboardMonthPeriods(year, month, today)
  );

  if (!rows.length) {
    return null;
  }

  const topDisplayScore = rows[0].displayScore;

  return {
    year,
    month,
    tiedTeams: rows.filter(row => row.displayScore === topDisplayScore),
    ...rows[0]
  };
}

function calculateTeamScore({ memberCount, weightedTotal, userCompletionCounts }) {
  if (!Number.isFinite(memberCount) || memberCount <= 0) {
    return 0;
  }

  const cappedWeightedTotal = Math.max(0, Number(weightedTotal) || 0);
  const teamMaxWeightedTotal = memberCount * MAX_MONTHLY_COMPLETION_POINTS_PER_MEMBER;
  const completionRate = Math.min(cappedWeightedTotal / teamMaxWeightedTotal, 1);
  const completionScore = completionRate * MAX_COMPLETION_SCORE;
  const counts = Array.from(userCompletionCounts || []);
  const normalizedCounts = Array.from({ length: memberCount }, (_, index) => counts[index] || 0);
  const participationTotal = normalizedCounts.reduce((sum, count) => {
    const cappedCount = Math.min(Math.max(Number(count) || 0, 0), MAX_MONTHLY_COMPLETION_COUNT_PER_MEMBER);
    const participationValue = Math.min((cappedCount / MAX_MONTHLY_COMPLETION_COUNT_PER_MEMBER) ** 0.7, 1);
    return sum + participationValue;
  }, 0);
  const participationScore = (participationTotal / memberCount) * MAX_PARTICIPATION_SCORE;

  return Math.min(completionScore + participationScore, 1000);
}

async function buildLeaderboard(supabase, periods) {
  const { data: teams, error: teamsError } = await supabase
    .from('teams')
    .select('id,name,created_at')
    .order('created_at', { ascending: true });

  if (teamsError) {
    throw teamsError;
  }

  const { data: members, error: membersError } = await supabase
    .from('users')
    .select('id,team_id')
    .not('team_id', 'is', null);

  if (membersError) {
    throw membersError;
  }

  const teamStats = new Map((teams || []).map(team => [
    team.id,
    {
      teamId: team.id,
      teamName: team.name || '未命名戰隊',
      memberCount: 0,
      total: 0,
      weightedTotal: 0,
      average: 0,
      userCompletionCounts: new Map()
    }
  ]));
  const userTeamMap = new Map();

  (members || []).forEach(member => {
    if (!teamStats.has(member.team_id)) {
      return;
    }

    userTeamMap.set(member.id, member.team_id);
    const stats = teamStats.get(member.team_id);
    stats.memberCount += 1;
    stats.userCompletionCounts.set(member.id, 0);
  });

  const periodKeys = [...new Set(periods.map(period => period.periodKey))];
  const blessingTypes = [...new Set(periods.map(period => period.blessingType))];

  if (periodKeys.length > 0 && blessingTypes.length > 0 && userTeamMap.size > 0) {
    const { data: checkins, error: checkinsError } = await supabase
      .from('checkins')
      .select('user_id,blessing_type,period_key')
      .in('user_id', [...userTeamMap.keys()])
      .in('period_key', periodKeys)
      .in('blessing_type', blessingTypes);

    if (checkinsError) {
      throw checkinsError;
    }

    const validPeriodSet = new Set(periods.map(period => {
      return `${period.blessingType}:${period.periodKey}`;
    }));

    (checkins || []).forEach(checkin => {
      const teamId = userTeamMap.get(checkin.user_id);
      const stats = teamStats.get(teamId);

      if (!stats || !validPeriodSet.has(`${checkin.blessing_type}:${checkin.period_key}`)) {
        return;
      }

      stats.total += 1;
      stats.weightedTotal += TASK_WEIGHTS[checkin.blessing_type] || 0;
      stats.userCompletionCounts.set(
        checkin.user_id,
        (stats.userCompletionCounts.get(checkin.user_id) || 0) + 1
      );
    });
  }

  const sortedRows = [...teamStats.values()]
    .filter(stats => (
      stats.memberCount >= MIN_LEADERBOARD_MEMBERS
      && stats.memberCount <= MAX_LEADERBOARD_MEMBERS
      && stats.total > 0
    ))
    .map(stats => {
      const score = calculateTeamScore({
        memberCount: stats.memberCount,
        weightedTotal: stats.weightedTotal,
        userCompletionCounts: stats.userCompletionCounts.values()
      });

      return {
        ...stats,
        score,
        displayScore: Math.round(score),
        average: Number((stats.total / stats.memberCount).toFixed(1))
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      if (b.weightedTotal !== a.weightedTotal) {
        return b.weightedTotal - a.weightedTotal;
      }

      if (b.total !== a.total) {
        return b.total - a.total;
      }

      if (b.memberCount !== a.memberCount) {
        return b.memberCount - a.memberCount;
      }

      return a.teamName.localeCompare(b.teamName, 'zh-Hant');
    });

  return sortedRows.map((stats, index) => {
    const previous = sortedRows[index - 1];
    const rank = previous && previous.displayScore === stats.displayScore
      ? previous.rank
      : index + 1;

    stats.rank = rank;

    return {
      rank,
      teamId: stats.teamId,
      teamName: stats.teamName,
      memberCount: stats.memberCount,
      total: stats.total,
      weightedTotal: stats.weightedTotal,
      average: stats.average,
      score: stats.score,
      displayScore: stats.displayScore
    };
  });
}

module.exports.calculateTeamScore = calculateTeamScore;
