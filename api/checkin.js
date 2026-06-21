const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LINE_LOGIN_CHANNEL_ID = process.env.LINE_LOGIN_CHANNEL_ID;

const blessingColumnMap = {
  morningPrayer: 'morning_prayer',
  prayerMeeting: 'prayer_meeting',
  smallGroup: 'small_group',
  sunday: 'sunday',
  trainingSystem: 'training_system'
};

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

    const body = typeof req.body === 'string'
      ? JSON.parse(req.body || '{}')
      : req.body || {};

    const idToken = body.idToken;
    const blessingType = body.blessingType;

    if (!idToken) {
      return sendJson(res, 400, {
        success: false,
        error: 'Missing idToken'
      });
    }

    if (!blessingType || !blessingColumnMap[blessingType]) {
      return sendJson(res, 400, {
        success: false,
        error: 'Invalid blessingType'
      });
    }

    const lineProfile = await verifyLineIdToken(idToken);

    const lineUserId = lineProfile.sub;
    const displayName = lineProfile.name || '';
    const today = getTaipeiDateString();
    const recordKey = `${today}__${lineUserId}`;
    const statusColumn = blessingColumnMap[blessingType];

    const { error: insertError } = await supabase
      .from('checkins')
      .insert({
        date: today,
        line_user_id: lineUserId,
        display_name: displayName,
        blessing_type: blessingType
      });

    if (insertError) {
      throw insertError;
    }

    const upsertPayload = {
      record_key: recordKey,
      date: today,
      line_user_id: lineUserId,
      display_name: displayName,
      [statusColumn]: true,
      updated_at: new Date().toISOString()
    };

    const { error: upsertError } = await supabase
      .from('user_daily_status')
      .upsert(upsertPayload, {
        onConflict: 'record_key'
      });

    if (upsertError) {
      throw upsertError;
    }

    return sendJson(res, 200, {
      success: true,
      date: today,
      lineUserId,
      displayName,
      blessingType
    });

  } catch (error) {
    return sendJson(res, 500, {
      success: false,
      error: String(error.message || error)
    });
  }
};

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

function getTaipeiDateString() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  return formatter.format(new Date());
}

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}
