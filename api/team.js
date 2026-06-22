const {
  buildTeamSummary,
  createHttpError,
  generateInviteCode,
  getSupabaseClient,
  parseBody,
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
    const action = body.action || 'summary';

    if (!idToken) {
      return sendJson(res, 400, {
        success: false,
        error: 'Missing idToken'
      });
    }

    const lineProfile = await verifyLineIdToken(idToken);
    const supabase = getSupabaseClient();
    const user = await upsertLineUser(supabase, lineProfile);

    if (action === 'summary') {
      return sendJson(res, 200, await buildTeamSummary(supabase, user.id));
    }

    if (action === 'create') {
      await createTeam(supabase, user.id, body.name);
      return sendJson(res, 200, await buildTeamSummary(supabase, user.id));
    }

    if (action === 'join') {
      await joinTeam(supabase, user.id, body.inviteCode);
      return sendJson(res, 200, await buildTeamSummary(supabase, user.id));
    }

    if (action === 'leave') {
      await leaveTeam(supabase, user.id);
      return sendJson(res, 200, {
        success: true,
        team: null
      });
    }

    return sendJson(res, 400, {
      success: false,
      error: 'Invalid action'
    });
  } catch (error) {
    return sendError(res, error);
  }
};

async function createTeam(supabase, userId, rawName) {
  const name = String(rawName || '').trim();

  if (!name) {
    throw createHttpError(400, 'Missing team name');
  }

  let team = null;
  let lastError = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inviteCode = generateInviteCode();
    const { data, error } = await supabase
      .from('teams')
      .insert({
        name,
        invite_code: inviteCode,
        created_by_user_id: userId
      })
      .select('id')
      .single();

    if (!error) {
      team = data;
      break;
    }

    lastError = error;

    if (error.code !== '23505') {
      throw error;
    }
  }

  if (!team) {
    throw lastError || createHttpError(500, 'Unable to create invite code');
  }

  const { error: updateError } = await supabase
    .from('users')
    .update({ team_id: team.id })
    .eq('id', userId);

  if (updateError) {
    throw updateError;
  }
}

async function joinTeam(supabase, userId, rawInviteCode) {
  const inviteCode = String(rawInviteCode || '').trim().toUpperCase();

  if (!inviteCode) {
    throw createHttpError(400, 'Missing invite code');
  }

  const { data: team, error: teamError } = await supabase
    .from('teams')
    .select('id')
    .eq('invite_code', inviteCode)
    .maybeSingle();

  if (teamError) {
    throw teamError;
  }

  if (!team) {
    throw createHttpError(404, 'Team not found');
  }

  const { error: updateError } = await supabase
    .from('users')
    .update({ team_id: team.id })
    .eq('id', userId);

  if (updateError) {
    throw updateError;
  }
}

async function leaveTeam(supabase, userId) {
  const { error } = await supabase
    .from('users')
    .update({ team_id: null })
    .eq('id', userId);

  if (error) {
    throw error;
  }
}
