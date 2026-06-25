const {
  buildTeamSummary,
  createHttpError,
  generateInviteCode,
  getSupabaseClient,
  parseBody,
  sendError,
  sendJson,
  syncCurrentPeriodCheckinsToTeam,
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

    if (action === 'profile') {
      return sendJson(res, 200, {
        success: true,
        profile: {
          displayName: user.display_name || '',
          nickname: user.nickname || ''
        }
      });
    }

    if (action === 'create') {
      const updatedUser = await createTeam(supabase, user, body.name);
      await syncCurrentPeriodCheckinsToTeam(supabase, updatedUser);
      return sendJson(res, 200, await buildTeamSummary(supabase, updatedUser.id));
    }

    if (action === 'join') {
      const updatedUser = await joinTeam(supabase, user, body.inviteCode);
      await syncCurrentPeriodCheckinsToTeam(supabase, updatedUser);
      return sendJson(res, 200, await buildTeamSummary(supabase, updatedUser.id));
    }

    if (action === 'rename') {
      await renameTeam(supabase, user, body.name);
      return sendJson(res, 200, await buildTeamSummary(supabase, user.id));
    }

    if (action === 'updateNickname') {
      const nickname = await updateNickname(supabase, user.id, body.nickname);
      return sendJson(res, 200, {
        success: true,
        profile: {
          nickname
        }
      });
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

async function createTeam(supabase, user, rawName) {
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
        created_by_user_id: user.id
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
    .eq('id', user.id);

  if (updateError) {
    throw updateError;
  }

  return {
    ...user,
    team_id: team.id
  };
}

async function joinTeam(supabase, user, rawInviteCode) {
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
    .eq('id', user.id);

  if (updateError) {
    throw updateError;
  }

  return {
    ...user,
    team_id: team.id
  };
}

async function renameTeam(supabase, user, rawName) {
  const name = String(rawName || '').trim();

  if (!name) {
    throw createHttpError(400, 'Missing team name');
  }

  if (!user.team_id) {
    throw createHttpError(400, 'User is not in a team');
  }

  const { error } = await supabase
    .from('teams')
    .update({ name })
    .eq('id', user.team_id);

  if (error) {
    throw error;
  }
}

async function updateNickname(supabase, userId, rawNickname) {
  const nickname = String(rawNickname || '').trim();

  if (!nickname) {
    throw createHttpError(400, 'Missing nickname');
  }

  if (nickname.length > 30) {
    throw createHttpError(400, 'Nickname is too long');
  }

  const { error } = await supabase
    .from('users')
    .update({ nickname })
    .eq('id', userId);

  if (error) {
    throw error;
  }

  return nickname;
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
