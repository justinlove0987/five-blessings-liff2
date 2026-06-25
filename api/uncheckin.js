const {
  getCurrentTaskPeriods,
  getSupabaseClient,
  getTaskPeriod,
  parseBody,
  sendError,
  sendJson,
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
    const periods = getCurrentTaskPeriods();
    const taskPeriod = periods[blessingType];

    if (!taskPeriod.visible) {
      return sendJson(res, 400, {
        success: false,
        error: 'Task is not available today'
      });
    }

    const periodKey = taskPeriod.periodKey;
    const lineUserId = lineProfile.sub;

    const { data: existing, error: findError } = await supabase
      .from('checkins')
      .select('id')
      .eq('line_user_id', lineUserId)
      .eq('blessing_type', blessingType)
      .eq('period_key', periodKey)
      .maybeSingle();

    if (findError) {
      throw findError;
    }

    if (!existing) {
      return sendJson(res, 200, {
        success: true,
        alreadyUnchecked: true,
        completed: false,
        blessingType,
        periodType,
        periodKey
      });
    }

    const { error: deleteError } = await supabase
      .from('checkins')
      .delete()
      .eq('line_user_id', lineUserId)
      .eq('blessing_type', blessingType)
      .eq('period_key', periodKey);

    if (deleteError) {
      throw deleteError;
    }

    return sendJson(res, 200, {
      success: true,
      alreadyUnchecked: false,
      completed: false,
      blessingType,
      periodType,
      periodKey
    });

  } catch (error) {
    return sendError(res, error);
  }
};
