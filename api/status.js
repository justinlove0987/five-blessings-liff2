const {
  getCurrentTaskPeriods,
  getSupabaseClient,
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

    if (!idToken) {
      return sendJson(res, 400, {
        success: false,
        error: 'Missing idToken'
      });
    }

    const lineProfile = await verifyLineIdToken(idToken);
    const supabase = getSupabaseClient();
    const periods = getCurrentTaskPeriods();
    const visiblePeriods = Object.fromEntries(
      Object.entries(periods).filter(([, period]) => period.visible)
    );
    const periodKeys = Object.values(visiblePeriods).map(period => period.periodKey);

    const { data, error } = await supabase
      .from('checkins')
      .select('blessing_type,period_key,checked_in_at')
      .eq('line_user_id', lineProfile.sub)
      .in('period_key', periodKeys);

    if (error) {
      throw error;
    }

    const tasks = Object.fromEntries(
      Object.entries(visiblePeriods).map(([blessingType, period]) => {
        const row = (data || []).find(item => (
          item.blessing_type === blessingType
          && item.period_key === period.periodKey
        ));

        return [
          blessingType,
          {
            completed: Boolean(row),
            completedAt: row ? row.checked_in_at : null,
            periodType: period.periodType,
            periodKey: period.periodKey
          }
        ];
      })
    );

    return sendJson(res, 200, {
      success: true,
      tasks
    });

  } catch (error) {
    return sendError(res, error);
  }
};
