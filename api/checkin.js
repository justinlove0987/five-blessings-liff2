const {
  getSupabaseClient,
  getTaskPeriod,
  isMonthlyTwiceTask,
  parseBody,
  parseMonthlyTwicePeriodKey,
  resolveTaskPeriod,
  sendError,
  sendJson,
  upsertLineUser,
  verifyLineIdToken
} = require('./_shared');

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
    const blessingType = body.blessingType;
    const requestedPeriodKey = body.periodKey;
    const periodType = getTaskPeriod(blessingType);

    if (!idToken) {
      return sendJson(res, 400, {
        success: false,
        error: 'Missing idToken'
      });
    }

    if (!periodType) {
      return sendJson(res, 400, {
        success: false,
        error: 'Invalid blessingType'
      });
    }

    const lineProfile = await verifyLineIdToken(idToken);
    const supabase = getSupabaseClient();
    const user = await upsertLineUser(supabase, lineProfile);
    const taskPeriod = resolveTaskPeriod(blessingType, requestedPeriodKey);

    if (!taskPeriod || taskPeriod.visible === false) {
      return sendJson(res, 400, {
        success: false,
        error: 'Task is not available today'
      });
    }

    const periodKey = taskPeriod.periodKey;
    const lineUserId = lineProfile.sub;
    const displayName = lineProfile.name || '';

    if (isMonthlyTwiceTask(blessingType)) {
      await ensureMonthlyTwiceSequence(supabase, {
        lineUserId,
        blessingType,
        periodKey
      });
    }

    const existing = await findExistingCheckin(supabase, {
      lineUserId,
      blessingType,
      periodKey
    });

    if (existing) {
      await syncExistingCheckinUserSnapshot(supabase, {
        lineUserId,
        blessingType,
        periodKey,
        userId: user.id,
        teamId: user.team_id
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

    const checkedInAt = new Date().toISOString();
    const { error: insertError } = await supabase
      .from('checkins')
      .insert({
        user_id: user.id,
        team_id: user.team_id || null,
        line_user_id: lineUserId,
        display_name: displayName,
        blessing_type: blessingType,
        period_type: periodType,
        period_key: periodKey,
        checked_in_at: checkedInAt
      });

    if (insertError) {
      if (insertError.code === '23505') {
        await syncExistingCheckinUserSnapshot(supabase, {
          lineUserId,
          blessingType,
          periodKey,
          userId: user.id,
          teamId: user.team_id
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

    return sendJson(res, 200, {
      success: true,
      alreadyCompleted: false,
      completed: true,
      blessingType,
      periodType,
      periodKey
    });

  } catch (error) {
    return sendError(res, error);
  }
};

async function ensureMonthlyTwiceSequence(supabase, params) {
  const parsed = parseMonthlyTwicePeriodKey(params.periodKey);

  if (!parsed || parsed.occurrence !== 2) {
    return;
  }

  const firstPeriodKey = `${parsed.year}-${String(parsed.month).padStart(2, '0')}#1`;
  const { data, error } = await supabase
    .from('checkins')
    .select('id')
    .eq('line_user_id', params.lineUserId)
    .eq('blessing_type', params.blessingType)
    .eq('period_key', firstPeriodKey)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    const error = new Error('First monthly check-in is required before second');
    error.statusCode = 400;
    throw error;
  }
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

async function syncExistingCheckinUserSnapshot(supabase, params) {
  const { error } = await supabase
    .from('checkins')
    .update({
      user_id: params.userId,
      team_id: params.teamId || null
    })
    .eq('line_user_id', params.lineUserId)
    .eq('blessing_type', params.blessingType)
    .eq('period_key', params.periodKey);

  if (error) {
    throw error;
  }
}
