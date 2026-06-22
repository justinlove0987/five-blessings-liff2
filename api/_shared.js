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

  return Object.fromEntries(
    Object.entries(taskPeriodMap).map(([blessingType, periodType]) => [
      blessingType,
      {
        periodType,
        periodKey: getPeriodKey(periodType, today)
      }
    ])
  );
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
    return formatDateKey(getMondayDateParts(today));
  }

  return `${today.year}-${String(today.month).padStart(2, '0')}`;
}

function getMondayDateParts(today) {
  const date = new Date(Date.UTC(today.year, today.month - 1, today.day));
  const dayOfWeek = date.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
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
  parseBody,
  sendError,
  sendJson,
  verifyLineIdToken
};
