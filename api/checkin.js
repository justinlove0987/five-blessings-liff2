const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LINE_LOGIN_CHANNEL_ID = process.env.LINE_LOGIN_CHANNEL_ID;
const TAIPEI_TIME_ZONE = 'Asia/Taipei';

const taskPeriodMap = {
  morningPrayer: 'day',
  smallGroup: 'week',
  sunday: 'week',
  tithe: 'month'
};

let supabaseClient = null;

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return sendJson(res, 405, {
        success: false,
        error: 'Method not allowed'
      });
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !LINE_LOGIN_CHANNEL_ID) {
      return sendJson(res, 500, {
        success: false,
        error: 'Missing server environment variables'
      });
    }

    const body = parseBody(req.body);
    const idToken = body.idToken;
    const blessingType = body.blessingType;

    if (!idToken) {
      return sendJson(res, 400, {
        success: false,
        error: 'Missing idToken'
      });
    }

    if (!blessingType || !taskPeriodMap[blessingType]) {
      return sendJson(res, 400, {
        success: false,
        error: 'Invalid blessingType'
      });
    }

    const lineProfile = await verifyLineIdToken(idToken);
    const supabase = getSupabaseClient();
    const now = new Date();
    const taipeiToday = getTaipeiDateParts(now);
    const periodType = taskPeriodMap[blessingType];
    const periodKey = getPeriodKey(periodType, taipeiToday);
    const lineUserId = lineProfile.sub;
    const displayName = lineProfile.name || '';

    const existing = await findExistingCheckin(supabase, {
      lineUserId,
      blessingType,
      periodKey
    });

    if (existing) {
      await upsertTaskStatus(supabase, {
        lineUserId,
        displayName,
        blessingType,
        periodType,
        periodKey,
        completedAt: existing.checked_in_at || now.toISOString()
      });

      return sendJson(res, 200, {
        success: true,
        alreadyCompleted: true,
        completed: true,
        blessingType,
        periodType,
        periodKey
      });
    }

    const checkedInAt = now.toISOString();
    const { error: insertError } = await supabase
      .from('checkins')
      .insert({
        line_user_id: lineUserId,
        display_name: displayName,
        blessing_type: blessingType,
        period_type: periodType,
        period_key: periodKey,
        checked_in_at: checkedInAt
      });

    if (insertError) {
      if (insertError.code === '23505') {
        await upsertTaskStatus(supabase, {
          lineUserId,
          displayName,
          blessingType,
          periodType,
          periodKey,
          completedAt: checkedInAt
        });

        return sendJson(res, 200, {
          success: true,
          alreadyCompleted: true,
          completed: true,
          blessingType,
          periodType,
          periodKey
        });
      }

      throw insertError;
    }

    await upsertTaskStatus(supabase, {
      lineUserId,
      displayName,
      blessingType,
      periodType,
      periodKey,
      completedAt: checkedInAt
    });

    return sendJson(res, 200, {
      success: true,
      alreadyCompleted: false,
      completed: true,
      blessingType,
      periodType,
      periodKey
    });

  } catch (error) {
    return sendJson(res, 500, {
      success: false,
      error: String(error.message || error)
    });
  }
};

function parseBody(body) {
  if (typeof body === 'string') {
    return JSON.parse(body || '{}');
  }

  return body || {};
}

function getSupabaseClient() {
  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  }

  return supabaseClient;
}

async function findExistingCheckin(supabase, params) {
  const { data, error } = await supabase
    .from('checkins')
    .select('checked_in_at')
    .eq('line_user_id', params.lineUserId)
    .eq('blessing_type', params.blessingType)
    .eq('period_key', params.periodKey)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function upsertTaskStatus(supabase, params) {
  const { error } = await supabase
    .from('user_task_status')
    .upsert({
      line_user_id: params.lineUserId,
      display_name: params.displayName,
      blessing_type: params.blessingType,
      period_type: params.periodType,
      period_key: params.periodKey,
      completed: true,
      completed_at: params.completedAt,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'line_user_id,blessing_type,period_key'
    });

  if (error) {
    throw error;
  }
}

async function verifyLineIdToken(idToken) {
  const response = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      id_token: idToken,
      client_id: LINE_LOGIN_CHANNEL_ID
    })
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`LINE verify failed: ${text}`);
  }

  const profile = JSON.parse(text);

  if (!profile.sub) {
    throw new Error('Invalid LINE profile: missing sub');
  }

  return profile;
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
