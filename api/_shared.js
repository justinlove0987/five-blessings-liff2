const { createClient } = require('@supabase/supabase-js');

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
  getCurrentTaskPeriods,
  getSupabaseClient,
  getTaskPeriod,
  getVisibleTaskTypes,
  parseBody,
  sendError,
  sendJson,
  verifyLineIdToken
};
