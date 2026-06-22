const {
  buildHistoryDateLabel,
  buildHistoryTaskNote,
  getCurrentTaskPeriods,
  getHistoryPeriods,
  getSupabaseClient,
  getTaipeiDateParts,
  getVisibleTaskTypes,
  HISTORY_EARLIEST,
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
    const year = Number(body.year);
    const month = Number(body.month);
    const blessingType = body.blessingType;

    if (!idToken) {
      return sendJson(res, 400, {
        success: false,
        error: 'Missing idToken'
      });
    }

    if (!year || !month || !blessingType) {
      return sendJson(res, 400, {
        success: false,
        error: 'Missing year, month, or blessingType'
      });
    }

    const lineProfile = await verifyLineIdToken(idToken);
    const todayParts = getTaipeiDateParts(new Date());
    const periods = getHistoryPeriods(year, month, blessingType, todayParts);
    const currentPeriods = getCurrentTaskPeriods();
    const currentPeriodKey = currentPeriods[blessingType]
      ? currentPeriods[blessingType].periodKey
      : null;
    const currentVisible = getVisibleTaskTypes(todayParts).includes(blessingType);
    const periodKeys = periods.map(period => period.periodKey);

    let rows = [];

    if (periodKeys.length > 0) {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('checkins')
        .select('blessing_type,period_key,checked_in_at')
        .eq('line_user_id', lineProfile.sub)
        .eq('blessing_type', blessingType)
        .in('period_key', periodKeys);

      if (error) {
        throw error;
      }

      rows = data || [];
    }

    const items = periods.map(period => {
      const row = rows.find(item => item.period_key === period.periodKey);
      const completed = Boolean(row);
      const isCurrent = period.periodKey === currentPeriodKey;
      const canCheckin = isCurrent && currentVisible && !completed;

      return {
        blessingType: period.blessingType,
        periodType: period.periodType,
        periodKey: period.periodKey,
        dateLabel: buildHistoryDateLabel(period.blessingType, period.periodKey),
        note: buildHistoryTaskNote(period.blessingType, period.periodKey, currentPeriodKey),
        completed,
        completedAt: row ? row.checked_in_at : null,
        canCheckin
      };
    });

    return sendJson(res, 200, {
      success: true,
      year,
      month,
      blessingType,
      earliestYear: HISTORY_EARLIEST.year,
      earliestMonth: HISTORY_EARLIEST.month,
      items
    });
  } catch (error) {
    return sendError(res, error);
  }
};
