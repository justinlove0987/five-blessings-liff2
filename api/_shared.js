const { createClient } = require('@supabase/supabase-js');
const { randomInt } = require('crypto');

const TAIPEI_TIME_ZONE = 'Asia/Taipei';

const taskPeriodMap = {
  morningPrayer: 'day',
  smallGroup: 'week',
  sunday: 'week',
  tithe: 'month'
};

let supabaseClient = null;

function ensureEnvironment() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.LINE_LOGIN_CHANNEL_ID) {
    throw createHttpError(500, 'Missing server environment variables');
  }
}

function getSupabaseClient() {
  ensureEnvironment();

  if (!supabaseClient) {
    supabaseClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }

  return supabaseClient;
}

function parseBody(body) {
  if (typeof body === 'string') {
    return JSON.parse(body || '{}');
  }

  return body || {};
}

async function verifyLineIdToken(idToken) {
  ensureEnvironment();

  const response = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      id_token: idToken,
      client_id: process.env.LINE_LOGIN_CHANNEL_ID
    })
  });

  const text = await response.text();

  if (!response.ok) {
    throw createHttpError(401, `LINE verify failed: ${text}`);
  }

  const profile = JSON.parse(text);

  if (!profile.sub) {
    throw createHttpError(401, 'Invalid LINE profile: missing sub');
  }

  return profile;
}

function getTaskPeriod(blessingType) {
  return taskPeriodMap[blessingType];
}

function getCurrentTaskPeriods(date = new Date()) {
  const today = getTaipeiDateParts(date);
  const visibleTasks = getVisibleTaskTypes(today);

  return Object.fromEntries(
    Object.entries(taskPeriodMap).map(([blessingType, periodType]) => [
      blessingType,
      {
        visible: visibleTasks.includes(blessingType),
        periodType,
        periodKey: getPeriodKey(periodType, today)
      }
    ])
  );
}

function getTeamWeeklyPeriodKeys(date = new Date()) {
  const periods = getCurrentTaskPeriods(date);

  return Object.entries(periods).map(([blessingType, period]) => ({
    blessingType,
    periodType: period.periodType,
    periodKey: period.periodKey
  }));
}

function getVisibleTaskTypes(today = getTaipeiDateParts(new Date())) {
  const dayOfWeek = getUtcDateFromParts(today).getUTCDay();
  const tasks = ['smallGroup', 'sunday', 'tithe'];

  if (dayOfWeek >= 2 && dayOfWeek <= 6) {
    tasks.unshift('morningPrayer');
  }

  return tasks;
}

function getTaipeiDateParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TAIPEI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day)
  };
}

function getPeriodKey(periodType, today) {
  if (periodType === 'day') {
    return formatDateKey(today);
  }

  if (periodType === 'week') {
    return formatDateKey(getSundayDateParts(today));
  }

  return `${today.year}-${String(today.month).padStart(2, '0')}`;
}

function getSundayDateParts(today) {
  const date = getUtcDateFromParts(today);
  const dayOfWeek = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - dayOfWeek);

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function getUtcDateFromParts(dateParts) {
  return new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day));
}

function formatDateKey(dateParts) {
  return [
    dateParts.year,
    String(dateParts.month).padStart(2, '0'),
    String(dateParts.day).padStart(2, '0')
  ].join('-');
}

const HISTORY_EARLIEST = { year: 2026, month: 6 };

function compareDateParts(a, b) {
  if (a.year !== b.year) {
    return a.year - b.year;
  }

  if (a.month !== b.month) {
    return a.month - b.month;
  }

  return a.day - b.day;
}

function compareYearMonth(year, month, compareYear, compareMonth) {
  return (year - compareYear) * 12 + (month - compareMonth);
}

function addDaysToDateParts(dateParts, days) {
  const date = getUtcDateFromParts(dateParts);
  date.setUTCDate(date.getUTCDate() + days);

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function isMorningPrayerDay(dateParts) {
  const dayOfWeek = getUtcDateFromParts(dateParts).getUTCDay();
  return dayOfWeek >= 2 && dayOfWeek <= 6;
}

function getDaysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function getMorningPrayerPeriodsInMonth(year, month, todayParts) {
  const items = [];
  const daysInMonth = getDaysInMonth(year, month);

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateParts = { year, month, day };

    if (!isMorningPrayerDay(dateParts)) {
      continue;
    }

    if (compareDateParts(dateParts, todayParts) > 0) {
      continue;
    }

    items.push({
      blessingType: 'morningPrayer',
      periodType: 'day',
      periodKey: formatDateKey(dateParts),
      sortKey: formatDateKey(dateParts)
    });
  }

  return items.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
}

function getWeekPeriodsInMonth(year, month, blessingType, todayParts) {
  const monthStart = { year, month, day: 1 };
  const monthEnd = { year, month, day: getDaysInMonth(year, month) };
  const items = [];
  const seen = new Set();
  let sunday = getSundayDateParts(monthStart);

  while (compareDateParts(sunday, monthEnd) <= 0) {
    const weekEnd = addDaysToDateParts(sunday, 6);

    if (compareDateParts(weekEnd, monthStart) >= 0 && compareDateParts(sunday, todayParts) <= 0) {
      const periodKey = formatDateKey(sunday);

      if (!seen.has(periodKey)) {
        seen.add(periodKey);
        items.push({
          blessingType,
          periodType: 'week',
          periodKey,
          sortKey: periodKey
        });
      }
    }

    sunday = addDaysToDateParts(sunday, 7);
  }

  return items.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
}

function getTithePeriodInMonth(year, month, todayParts) {
  if (compareYearMonth(year, month, todayParts.year, todayParts.month) > 0) {
    return [];
  }

  const periodKey = `${year}-${String(month).padStart(2, '0')}`;

  return [{
    blessingType: 'tithe',
    periodType: 'month',
    periodKey,
    sortKey: periodKey
  }];
}

function getHistoryPeriods(year, month, blessingType, todayParts = getTaipeiDateParts(new Date())) {
  if (compareYearMonth(year, month, HISTORY_EARLIEST.year, HISTORY_EARLIEST.month) < 0) {
    return [];
  }

  if (compareYearMonth(year, month, todayParts.year, todayParts.month) > 0) {
    return [];
  }

  if (blessingType === 'morningPrayer') {
    return getMorningPrayerPeriodsInMonth(year, month, todayParts);
  }

  if (blessingType === 'smallGroup' || blessingType === 'sunday') {
    return getWeekPeriodsInMonth(year, month, blessingType, todayParts);
  }

  if (blessingType === 'tithe') {
    return getTithePeriodInMonth(year, month, todayParts);
  }

  return [];
}

function getLeaderboardWeekPeriods(date = new Date()) {
  const today = getTaipeiDateParts(date);
  const weekStart = getSundayDateParts(today);
  const periods = [];

  for (let offset = 0; offset < 7; offset += 1) {
    const dateParts = addDaysToDateParts(weekStart, offset);

    if (compareDateParts(dateParts, today) > 0) {
      continue;
    }

    if (isMorningPrayerDay(dateParts)) {
      periods.push({
        blessingType: 'morningPrayer',
        periodType: 'day',
        periodKey: formatDateKey(dateParts)
      });
    }
  }

  ['smallGroup', 'sunday'].forEach(blessingType => {
    periods.push({
      blessingType,
      periodType: 'week',
      periodKey: formatDateKey(weekStart)
    });
  });

  return periods;
}

function getLeaderboardMonthPeriods(year, month, todayParts = getTaipeiDateParts(new Date())) {
  return ['morningPrayer', 'smallGroup', 'sunday', 'tithe']
    .flatMap(blessingType => getHistoryPeriods(year, month, blessingType, todayParts));
}

async function upsertLineUser(supabase, lineProfile) {
  const lineUserId = lineProfile.sub;

  if (!lineUserId) {
    throw createHttpError(401, 'Invalid LINE profile: missing sub');
  }

  const { data, error } = await supabase
    .from('users')
    .upsert({
      line_user_id: lineUserId,
      display_name: lineProfile.name || '',
      picture_url: lineProfile.picture || null
    }, {
      onConflict: 'line_user_id'
    })
    .select('id,line_user_id,display_name,picture_url,team_id')
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function buildTeamSummary(supabase, userId) {
  const { data: currentUser, error: userError } = await supabase
    .from('users')
    .select('id,team_id')
    .eq('id', userId)
    .maybeSingle();

  if (userError) {
    throw userError;
  }

  if (!currentUser || !currentUser.team_id) {
    return {
      success: true,
      team: null
    };
  }

  const { data: team, error: teamError } = await supabase
    .from('teams')
    .select('id,name,invite_code')
    .eq('id', currentUser.team_id)
    .maybeSingle();

  if (teamError) {
    throw teamError;
  }

  if (!team) {
    return {
      success: true,
      team: null
    };
  }

  const { data: members, error: membersError } = await supabase
    .from('users')
    .select('id,display_name,picture_url,created_at')
    .eq('team_id', team.id)
    .order('created_at', { ascending: true });

  if (membersError) {
    throw membersError;
  }

  const memberTotals = new Map((members || []).map(member => [member.id, 0]));
  const memberIds = new Set(memberTotals.keys());
  const periods = getTeamWeeklyPeriodKeys();
  const periodKeys = [...new Set(periods.map(period => period.periodKey))];
  const blessingTypes = [...new Set(periods.map(period => period.blessingType))];

  if (periodKeys.length > 0 && blessingTypes.length > 0) {
    const { data: checkins, error: checkinsError } = await supabase
      .from('checkins')
      .select('user_id,blessing_type,period_key')
      .eq('team_id', team.id)
      .in('period_key', periodKeys)
      .in('blessing_type', blessingTypes);

    if (checkinsError) {
      throw checkinsError;
    }

    (checkins || []).forEach(checkin => {
      if (!checkin.user_id || !memberTotals.has(checkin.user_id)) {
        return;
      }

      memberTotals.set(checkin.user_id, memberTotals.get(checkin.user_id) + 1);
    });
  }

  const todayParts = getTaipeiDateParts(new Date());
  const monthPeriods = getLeaderboardMonthPeriods(todayParts.year, todayParts.month, todayParts);
  const monthPeriodKeys = [...new Set(monthPeriods.map(period => period.periodKey))];
  const monthBlessingTypes = [...new Set(monthPeriods.map(period => period.blessingType))];
  const memberMonthlyTotals = new Map((members || []).map(member => [member.id, 0]));
  let monthlyTotal = 0;

  if (monthPeriodKeys.length > 0 && monthBlessingTypes.length > 0) {
    const { data: monthCheckins, error: monthCheckinsError } = await supabase
      .from('checkins')
      .select('user_id,blessing_type,period_key')
      .eq('team_id', team.id)
      .in('period_key', monthPeriodKeys)
      .in('blessing_type', monthBlessingTypes);

    if (monthCheckinsError) {
      throw monthCheckinsError;
    }

    (monthCheckins || []).forEach(checkin => {
      if (!checkin.user_id || !memberIds.has(checkin.user_id)) {
        return;
      }

      memberMonthlyTotals.set(checkin.user_id, memberMonthlyTotals.get(checkin.user_id) + 1);
      monthlyTotal += 1;
    });
  }

  const summaryMembers = (members || []).map(member => ({
    id: member.id,
    displayName: member.display_name || '小隊成員',
    pictureUrl: member.picture_url || null,
    weeklyTotal: memberTotals.get(member.id) || 0,
    monthlyTotal: memberMonthlyTotals.get(member.id) || 0
  }));

  return {
    success: true,
    team: {
      id: team.id,
      name: team.name,
      inviteCode: team.invite_code
    },
    weeklyTotal: summaryMembers.reduce((sum, member) => sum + member.weeklyTotal, 0),
    monthlyTotal,
    monthlyLabel: `${todayParts.month}月`,
    members: summaryMembers
  };
}

async function syncCurrentPeriodCheckinsToTeam(supabase, user) {
  if (!user || !user.id || !user.team_id || !user.line_user_id) {
    return;
  }

  const todayParts = getTaipeiDateParts(new Date());
  const periods = [
    ...getTeamWeeklyPeriodKeys(),
    ...getLeaderboardMonthPeriods(todayParts.year, todayParts.month, todayParts)
  ];
  const periodKeys = [...new Set(periods.map(period => period.periodKey))];
  const blessingTypes = [...new Set(periods.map(period => period.blessingType))];

  if (periodKeys.length === 0 || blessingTypes.length === 0) {
    return;
  }

  const { error } = await supabase
    .from('checkins')
    .update({
      user_id: user.id,
      team_id: user.team_id
    })
    .eq('line_user_id', user.line_user_id)
    .in('period_key', periodKeys)
    .in('blessing_type', blessingTypes);

  if (error) {
    throw error;
  }
}

function generateInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';

  for (let index = 0; index < 6; index += 1) {
    code += alphabet[randomInt(alphabet.length)];
  }

  return code;
}

function buildHistoryDateLabel(blessingType, periodKey) {
  if (blessingType === 'morningPrayer') {
    const [year, month, day] = periodKey.split('-').map(Number);
    const weekday = ['日', '一', '二', '三', '四', '五', '六'][
      getUtcDateFromParts({ year, month, day }).getUTCDay()
    ];
    return `${month}/${day}（${weekday}）`;
  }

  if (blessingType === 'smallGroup' || blessingType === 'sunday') {
    const [year, month, day] = periodKey.split('-').map(Number);
    const start = { year, month, day };
    const end = addDaysToDateParts(start, 6);
    const startWeekday = ['日', '一', '二', '三', '四', '五', '六'][
      getUtcDateFromParts(start).getUTCDay()
    ];
    const endWeekday = ['日', '一', '二', '三', '四', '五', '六'][
      getUtcDateFromParts(end).getUTCDay()
    ];
    return `${start.month}/${start.day}（${startWeekday}） - ${end.month}/${end.day}（${endWeekday}）`;
  }

  const [year, month] = periodKey.split('-').map(Number);
  return `${month}月`;
}

function buildHistoryTaskNote(blessingType, periodKey, currentPeriodKey) {
  const isCurrent = periodKey === currentPeriodKey;

  if (blessingType === 'morningPrayer') {
    return isCurrent ? '今日可打卡' : '每日可打卡一次';
  }

  if (blessingType === 'smallGroup' || blessingType === 'sunday') {
    return isCurrent ? '本週完成一次' : '每週完成一次';
  }

  return isCurrent ? '本月完成一次' : '每月完成一次';
}

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function sendError(res, error) {
  sendJson(res, error.statusCode || 500, {
    success: false,
    error: String(error.message || error)
  });
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  buildHistoryDateLabel,
  buildHistoryTaskNote,
  getCurrentTaskPeriods,
  getHistoryPeriods,
  getLeaderboardMonthPeriods,
  getLeaderboardWeekPeriods,
  getSupabaseClient,
  getTaskPeriod,
  getTeamWeeklyPeriodKeys,
  getTaipeiDateParts,
  getVisibleTaskTypes,
  HISTORY_EARLIEST,
  parseBody,
  sendError,
  sendJson,
  buildTeamSummary,
  createHttpError,
  generateInviteCode,
  syncCurrentPeriodCheckinsToTeam,
  upsertLineUser,
  verifyLineIdToken
};
