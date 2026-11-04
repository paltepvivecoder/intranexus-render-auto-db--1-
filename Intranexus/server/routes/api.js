import { Router } from 'express';
import { withTransaction, requirePool } from '../db/pool.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { newId } from '../services/auth.js';
import { writeAudit, publishChange } from '../services/audit.js';
import { makeRoundRobin, makeSingleElimination } from '../services/tournaments.js';

const router = Router();
const adminsAndOrganizers = requireRoles('admin', 'organizer');
const staff = requireRoles('admin', 'organizer', 'teacher');
const roles = new Set(['admin', 'organizer', 'teacher', 'student']);
const medals = new Set(['gold', 'silver', 'bronze']);

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}
function requiredText(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw fail(400, 'invalid_input', `${label} ay kailangan at hindi dapat lumampas sa ${max} character.`);
  return value.trim();
}
function optionalText(value, label, max = 500) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.trim().length > max) throw fail(400, 'invalid_input', `Hindi wasto ang ${label}.`);
  return value.trim();
}
function validUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function toDateOrNull(value, label) {
  if (value == null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw fail(400, 'invalid_input', `Hindi wasto ang ${label}.`);
  return date.toISOString();
}
async function ensureEvent(client, eventId) {
  if (!validUuid(eventId)) throw fail(400, 'invalid_id', 'Hindi wasto ang event ID.');
  const result = await client.query('SELECT * FROM events WHERE id = $1', [eventId]);
  if (!result.rowCount) throw fail(404, 'not_found', 'Hindi makita ang event.');
  return result.rows[0];
}
async function ensureTeam(client, teamId) {
  if (!validUuid(teamId)) throw fail(400, 'invalid_id', 'Hindi wasto ang team ID.');
  const result = await client.query('SELECT * FROM teams WHERE id = $1 AND deleted_at IS NULL', [teamId]);
  if (!result.rowCount) throw fail(404, 'not_found', 'Hindi makita ang team.');
  return result.rows[0];
}
function mapFixture(fixture) {
  return {
    id: fixture.id,
    eventId: fixture.eventId,
    roundNumber: fixture.roundNumber,
    stage: fixture.stage,
    matchNumber: fixture.matchNumber,
    homeTeamId: fixture.homeTeamId,
    awayTeamId: fixture.awayTeamId,
    status: fixture.status,
    winnerTeamId: fixture.winnerTeamId,
    isLocked: fixture.isLocked,
    nextMatchId: fixture.nextMatchId || null,
    nextSlot: fixture.nextSlot || null,
    createdBy: fixture.createdBy,
  };
}

router.get('/dashboard', requireAuth, async (req, res) => {
  const [events, upcoming, announcements] = await Promise.all([
    requirePool().query(`SELECT count(*)::int AS count FROM events WHERE status NOT IN ('completed', 'cancelled')`),
    requirePool().query(
      `SELECT m.id, m.scheduled_at, m.status, m.venue, e.name AS event_name,
              ht.name AS home_team, at.name AS away_team, m.home_score, m.away_score
         FROM matches m JOIN events e ON e.id = m.event_id
         LEFT JOIN teams ht ON ht.id = m.home_team_id LEFT JOIN teams at ON at.id = m.away_team_id
        WHERE m.status IN ('upcoming', 'ongoing')
          AND (m.home_team_id IS NOT NULL OR m.away_team_id IS NOT NULL)
        ORDER BY m.scheduled_at NULLS LAST, m.round_number, m.match_number LIMIT 8`,
    ),
    requirePool().query(
      `SELECT id, title, content, target_audience, created_at
         FROM announcements WHERE deleted_at IS NULL
           AND (target_audience @> ARRAY['all']::text[] OR target_audience @> ARRAY[$1]::text[])
        ORDER BY created_at DESC LIMIT 5`,
      [req.user.role],
    ),
  ]);
  res.json({ activeEventCount: events.rows[0].count, upcomingMatches: upcoming.rows, announcements: announcements.rows });
});

router.get('/events', requireAuth, async (req, res) => {
  const values = [];
  const where = [];
  if (req.query.category && ['sports', 'esports'].includes(req.query.category)) {
    values.push(req.query.category); where.push(`e.category = $${values.length}`);
  }
  if (req.query.status && ['draft', 'registration', 'ongoing', 'completed', 'cancelled'].includes(req.query.status)) {
    values.push(req.query.status); where.push(`e.status = $${values.length}`);
  }
  const result = await requirePool().query(
    `SELECT e.id, e.name, e.category, e.event_format, e.description, e.starts_at, e.ends_at,
            e.venue, e.status, e.created_at,
            (SELECT count(*)::int FROM teams t WHERE t.event_id = e.id AND t.deleted_at IS NULL) AS team_count,
            (SELECT count(*)::int FROM matches m WHERE m.event_id = e.id) AS match_count
       FROM events e ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY e.starts_at NULLS LAST, e.created_at DESC`, values,
  );
  res.json({ items: result.rows });
});

router.post('/events', requireAuth, adminsAndOrganizers, async (req, res) => {
  const name = requiredText(req.body?.name, 'Pangalan ng event', 140);
  const category = req.body?.category;
  const eventFormat = req.body?.eventFormat;
  if (!['sports', 'esports'].includes(category)) throw fail(400, 'invalid_category', 'Pumili ng sports o esports event.');
  const expectedFormat = category === 'sports' ? 'round_robin' : 'single_elimination';
  if (eventFormat !== expectedFormat) throw fail(400, 'invalid_format', 'Hindi tugma ang bracket format sa uri ng event.');
  const id = newId();
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO events (id, name, category, event_format, description, starts_at, ends_at, venue, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9)`,
      [id, name, category, eventFormat, optionalText(req.body?.description, 'description', 3000), toDateOrNull(req.body?.startsAt, 'start date'), toDateOrNull(req.body?.endsAt, 'end date'), optionalText(req.body?.venue, 'venue', 180), req.user.id],
    );
    await writeAudit(client, { actorId: req.user.id, action: 'event.created', entity: 'event', entityId: id, changes: { name, category, eventFormat } });
    await publishChange(client, 'events', id);
  });
  res.status(201).json({ id, name, category, eventFormat, status: 'draft' });
});

router.get('/events/:eventId/summary', requireAuth, async (req, res) => {
  const event = await ensureEvent(requirePool(), req.params.eventId);
  const teamsResult = await requirePool().query(
    `SELECT t.id, t.name, t.category, u.full_name AS camp_leader
       FROM teams t LEFT JOIN users u ON u.id=t.camp_leader_id
      WHERE t.event_id=$1 AND t.deleted_at IS NULL ORDER BY t.name`, [event.id],
  );
  res.json({ event, teams: teamsResult.rows, teamCount: teamsResult.rowCount, canGenerate: teamsResult.rowCount >= 2, requiresConfirmation: true });
});

router.post('/events/:eventId/generate', requireAuth, adminsAndOrganizers, async (req, res) => {
  const eventId = req.params.eventId;
  const fixtureCount = await withTransaction(async (client) => {
    const event = await ensureEvent(client, eventId);
    if (req.body?.summaryConfirmed !== true) throw fail(400, 'summary_confirmation_required', 'Suriin at kumpirmahin muna ang tournament summary.');
    const existing = await client.query('SELECT 1 FROM matches WHERE event_id=$1 LIMIT 1', [eventId]);
    if (existing.rowCount) throw fail(409, 'bracket_already_generated', 'May existing matches na para sa event na ito. Hindi ito awtomatikong papalitan.');
    const teamResult = await client.query('SELECT id FROM teams WHERE event_id=$1 AND deleted_at IS NULL ORDER BY created_at, id', [eventId]);
    if (teamResult.rowCount < 2) throw fail(400, 'not_enough_teams', 'Kailangan ng hindi bababa sa dalawang team bago gumawa ng bracket.');
    const ids = teamResult.rows.map((row) => row.id);
    const fixtures = event.event_format === 'round_robin' ? makeRoundRobin(ids) : makeSingleElimination(ids);
    for (const raw of fixtures) {
      const fixture = mapFixture({ ...raw, eventId, createdBy: req.user.id });
      await client.query(
        `INSERT INTO matches (id,event_id,round_number,stage,match_number,home_team_id,away_team_id,
           status,winner_team_id,is_locked,locked_at,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $10 THEN now() ELSE NULL END,$11)`,
        [fixture.id, fixture.eventId, fixture.roundNumber, fixture.stage, fixture.matchNumber,
          fixture.homeTeamId, fixture.awayTeamId, fixture.status, fixture.winnerTeamId, fixture.isLocked, fixture.createdBy],
      );
    }
    for (const raw of fixtures) {
      const fixture = mapFixture({ ...raw, eventId, createdBy: req.user.id });
      if (fixture.nextMatchId) {
        await client.query('UPDATE matches SET next_match_id=$1,next_slot=$2 WHERE id=$3', [fixture.nextMatchId, fixture.nextSlot, fixture.id]);
      }
    }
    // Apply first-round automatic byes to their corresponding later-round slot.
    for (const fixture of fixtures.filter((item) => item.status === 'bye' && item.nextMatchId)) {
      const slot = fixture.nextSlot === 'home' ? 'home_team_id' : 'away_team_id';
      await client.query(`UPDATE matches SET ${slot}=$1 WHERE id=$2`, [fixture.winnerTeamId, fixture.nextMatchId]);
    }
    await client.query('UPDATE events SET generation_confirmed_at=now(), status=CASE WHEN status=\'draft\' THEN \'registration\' ELSE status END, updated_at=now() WHERE id=$1', [eventId]);
    await writeAudit(client, { actorId: req.user.id, action: 'tournament.bracket_generated', entity: 'event', entityId: eventId, changes: { format: event.event_format, fixtureCount: fixtures.length, teamCount: ids.length } });
    await publishChange(client, 'matches', eventId);
    return fixtures.length;
  });
  res.status(201).json({ ok: true, fixtureCount, message: 'Nagawa ang bracket mula sa kumpirmadong tournament summary.' });
});

router.get('/events/:eventId', requireAuth, async (req, res) => {
  const event = await ensureEvent(requirePool(), req.params.eventId);
  const [teams, matches] = await Promise.all([
    requirePool().query(`SELECT t.id,t.name,t.category,u.full_name AS camp_leader FROM teams t LEFT JOIN users u ON u.id=t.camp_leader_id WHERE t.event_id=$1 AND t.deleted_at IS NULL ORDER BY t.name`, [event.id]),
    requirePool().query(`SELECT m.*,ht.name AS home_team,at.name AS away_team FROM matches m LEFT JOIN teams ht ON ht.id=m.home_team_id LEFT JOIN teams at ON at.id=m.away_team_id WHERE m.event_id=$1 ORDER BY m.round_number,m.match_number`, [event.id]),
  ]);
  res.json({ event, teams: teams.rows, matches: matches.rows });
});

router.patch('/events/:eventId', requireAuth, adminsAndOrganizers, async (req, res) => {
  const result = await withTransaction(async (client) => {
    const event = await ensureEvent(client, req.params.eventId);
    const name = req.body?.name === undefined ? event.name : requiredText(req.body.name, 'Pangalan ng event', 140);
    const description = req.body?.description === undefined ? event.description : optionalText(req.body.description, 'description', 3000);
    const venue = req.body?.venue === undefined ? event.venue : optionalText(req.body.venue, 'venue', 180);
    const startsAt = req.body?.startsAt === undefined ? event.starts_at : toDateOrNull(req.body.startsAt, 'start date');
    const endsAt = req.body?.endsAt === undefined ? event.ends_at : toDateOrNull(req.body.endsAt, 'end date');
    const status = req.body?.status === undefined ? event.status : req.body.status;
    if (!['draft', 'registration', 'ongoing', 'completed', 'cancelled'].includes(status)) throw fail(400, 'invalid_status', 'Hindi wastong event status.');
    const updated = await client.query(`UPDATE events SET name=$1,description=$2,venue=$3,starts_at=$4,ends_at=$5,status=$6,updated_at=now() WHERE id=$7 RETURNING *`, [name, description, venue, startsAt, endsAt, status, event.id]);
    await writeAudit(client, { actorId: req.user.id, action: 'event.updated', entity: 'event', entityId: event.id, changes: { name, venue, status } });
    await publishChange(client, 'events', event.id);
    return updated.rows[0];
  });
  res.json(result);
});

router.get('/teams', requireAuth, async (req, res) => {
  const values = [];
  let where = 't.deleted_at IS NULL';
  if (req.query.eventId && validUuid(req.query.eventId)) { values.push(req.query.eventId); where += ` AND t.event_id=$${values.length}`; }
  if (req.query.q) { values.push(`%${String(req.query.q).slice(0, 80)}%`); where += ` AND t.name ILIKE $${values.length}`; }
  const result = await requirePool().query(
    `SELECT t.id,t.event_id,t.name,t.category,t.camp_leader_id,u.full_name AS camp_leader,
            count(tm.user_id)::int AS member_count,e.name AS event_name
       FROM teams t JOIN events e ON e.id=t.event_id LEFT JOIN users u ON u.id=t.camp_leader_id
       LEFT JOIN team_members tm ON tm.team_id=t.id
      WHERE ${where} GROUP BY t.id,u.full_name,e.name ORDER BY t.name`, values,
  );
  res.json({ items: result.rows });
});

router.post('/teams', requireAuth, adminsAndOrganizers, async (req, res) => {
  const eventId = req.body?.eventId;
  const name = requiredText(req.body?.name, 'Pangalan ng team', 120);
  const category = optionalText(req.body?.category, 'category', 100);
  const leaderId = req.body?.campLeaderId || null;
  const id = newId();
  await withTransaction(async (client) => {
    await ensureEvent(client, eventId);
    if (leaderId) {
      const leader = await client.query(`SELECT id FROM users WHERE id=$1 AND role='teacher' AND account_status='approved'`, [leaderId]);
      if (!leader.rowCount) throw fail(400, 'invalid_camp_leader', 'Ang camp leader ay kailangang aprubadong Teacher account.');
    }
    await client.query(`INSERT INTO teams(id,event_id,name,category,camp_leader_id,created_by) VALUES($1,$2,$3,$4,$5,$6)`, [id,eventId,name,category,leaderId,req.user.id]);
    await writeAudit(client, { actorId: req.user.id, action: 'team.created', entity: 'team', entityId: id, changes: { eventId, name, campLeaderId: leaderId } });
    await publishChange(client, 'teams', id);
  });
  res.status(201).json({ id, eventId, name, category, campLeaderId: leaderId });
});

router.get('/teams/:teamId', requireAuth, async (req, res) => {
  const team = await ensureTeam(requirePool(), req.params.teamId);
  const result = await requirePool().query(
    `SELECT u.id,u.full_name,u.email,tm.is_captain,u.enrolled_verified,u.tryout_passed
       FROM team_members tm JOIN users u ON u.id=tm.user_id WHERE tm.team_id=$1 ORDER BY u.full_name`, [team.id],
  );
  const leader = team.camp_leader_id ? await requirePool().query('SELECT full_name FROM users WHERE id=$1', [team.camp_leader_id]) : { rows: [] };
  res.json({ team: { ...team, camp_leader: leader.rows[0]?.full_name || null }, members: result.rows });
});

router.patch('/teams/:teamId', requireAuth, adminsAndOrganizers, async (req, res) => {
  const result = await withTransaction(async (client) => {
    const team = await ensureTeam(client, req.params.teamId);
    const name = req.body?.name === undefined ? team.name : requiredText(req.body.name, 'Pangalan ng team', 120);
    const category = req.body?.category === undefined ? team.category : optionalText(req.body.category, 'category', 100);
    const leaderId = req.body?.campLeaderId === undefined ? team.camp_leader_id : (req.body.campLeaderId || null);
    if (leaderId) {
      const leader = await client.query(`SELECT id FROM users WHERE id=$1 AND role='teacher' AND account_status='approved'`, [leaderId]);
      if (!leader.rowCount) throw fail(400, 'invalid_camp_leader', 'Ang camp leader ay kailangang aprubadong Teacher account.');
    }
    const updated = await client.query(`UPDATE teams SET name=$1,category=$2,camp_leader_id=$3,updated_at=now() WHERE id=$4 RETURNING *`, [name,category,leaderId,team.id]);
    await writeAudit(client, { actorId: req.user.id, action: 'team.updated', entity: 'team', entityId: team.id, changes: { name, category, campLeaderId: leaderId } });
    await publishChange(client, 'teams', team.id);
    return updated.rows[0];
  });
  res.json(result);
});

router.delete('/teams/:teamId', requireAuth, adminsAndOrganizers, async (req, res) => {
  await withTransaction(async (client) => {
    const team = await ensureTeam(client, req.params.teamId);
    await client.query('UPDATE teams SET deleted_at=now(),updated_at=now() WHERE id=$1', [team.id]);
    await writeAudit(client, { actorId: req.user.id, action: 'team.archived', entity: 'team', entityId: team.id });
    await publishChange(client, 'teams', team.id);
  });
  res.json({ ok: true, message: 'Na-archive ang team; napanatili ang official match records.' });
});

router.post('/teams/:teamId/members', requireAuth, staff, async (req, res) => {
  const result = await withTransaction(async (client) => {
    const team = await ensureTeam(client, req.params.teamId);
    if (req.user.role === 'teacher' && team.camp_leader_id !== req.user.id) throw fail(403, 'forbidden', 'Maaari lamang magtalaga ang Teacher sa camp/team na pinamumunuan niya.');
    const userId = req.body?.userId;
    if (!validUuid(userId)) throw fail(400, 'invalid_id', 'Hindi wasto ang student ID.');
    const student = await client.query(`SELECT id,enrolled_verified,tryout_passed FROM users WHERE id=$1 AND role='student' AND account_status='approved' FOR UPDATE`, [userId]);
    if (!student.rowCount) throw fail(404, 'student_not_found', 'Hindi makita ang aprubadong student account.');
    if (!student.rows[0].enrolled_verified || !student.rows[0].tryout_passed) throw fail(409, 'student_not_eligible', 'Kailangang beripikahin ang official enrollment at tryout bago idagdag sa lineup.');
    const isCaptain = req.body?.isCaptain === true;
    const inserted = await client.query(
      `INSERT INTO team_members(team_id,user_id,is_captain,assigned_by)
       VALUES($1,$2,$3,$4) ON CONFLICT(team_id,user_id) DO UPDATE SET is_captain=EXCLUDED.is_captain,assigned_by=EXCLUDED.assigned_by,assigned_at=now() RETURNING *`,
      [team.id,userId,isCaptain,req.user.id],
    );
    await writeAudit(client, { actorId: req.user.id, action: 'team.member_assigned', entity: 'team', entityId: team.id, changes: { studentId: userId, isCaptain } });
    await publishChange(client, 'teams', team.id);
    return inserted.rows[0];
  });
  res.status(201).json(result);
});

router.delete('/teams/:teamId/members/:userId', requireAuth, staff, async (req, res) => {
  await withTransaction(async (client) => {
    const team = await ensureTeam(client, req.params.teamId);
    if (req.user.role === 'teacher' && team.camp_leader_id !== req.user.id) throw fail(403, 'forbidden', 'Maaari lamang mag-manage ang Teacher sa camp/team na pinamumunuan niya.');
    const result = await client.query('DELETE FROM team_members WHERE team_id=$1 AND user_id=$2', [team.id, req.params.userId]);
    if (!result.rowCount) throw fail(404, 'not_found', 'Hindi makita ang player sa lineup.');
    await writeAudit(client, { actorId: req.user.id, action: 'team.member_removed', entity: 'team', entityId: team.id, changes: { studentId: req.params.userId } });
    await publishChange(client, 'teams', team.id);
  });
  res.json({ ok: true });
});

router.patch('/users/:userId/eligibility', requireAuth, staff, async (req, res) => {
  const userId = req.params.userId;
  const teamId = req.body?.teamId;
  if (!validUuid(userId)) throw fail(400, 'invalid_id', 'Hindi wasto ang student ID.');
  if (teamId && !validUuid(teamId)) throw fail(400, 'invalid_team_id', 'Hindi wasto ang team/camp ID.');
  const enrolledVerified = req.body?.enrolledVerified;
  const tryoutPassed = req.body?.tryoutPassed;
  if (typeof enrolledVerified !== 'boolean' || typeof tryoutPassed !== 'boolean') throw fail(400, 'invalid_input', 'Kailangan ang enrollment verification at tryout status.');
  const result = await withTransaction(async (client) => {
    const student = await client.query(`SELECT id FROM users WHERE id=$1 AND role='student' AND account_status='approved' FOR UPDATE`, [userId]);
    if (!student.rowCount) throw fail(404, 'student_not_found', 'Hindi makita ang aprubadong student account.');
    if (req.user.role === 'teacher') {
      if (!teamId) throw fail(400, 'team_required', 'Piliin ang camp/team na pinamumunuan mo.');
      const team = await ensureTeam(client, teamId);
      if (team.camp_leader_id !== req.user.id) throw fail(403, 'forbidden', 'Maaari ka lamang mag-verify para sa camp/team na pinamumunuan mo.');
    }
    await client.query('UPDATE users SET enrolled_verified=$1,tryout_passed=$2,updated_at=now() WHERE id=$3', [enrolledVerified,tryoutPassed,userId]);
    await writeAudit(client, { actorId: req.user.id, action: 'student.eligibility_verified', entity: 'user', entityId: userId, changes: { enrolledVerified, tryoutPassed, teamId: teamId || null } });
    return { userId, enrolledVerified, tryoutPassed, teamId: teamId || null };
  });
  res.json(result);
});

router.get('/matches', requireAuth, async (req, res) => {
  const values = [];
  const where = [];
  if (req.query.eventId && validUuid(req.query.eventId)) { values.push(req.query.eventId); where.push(`m.event_id=$${values.length}`); }
  if (req.query.status && ['upcoming','ongoing','finished','bye','cancelled'].includes(req.query.status)) { values.push(req.query.status); where.push(`m.status=$${values.length}`); }
  if (req.query.q) { values.push(`%${String(req.query.q).slice(0,80)}%`); where.push(`(ht.name ILIKE $${values.length} OR at.name ILIKE $${values.length} OR e.name ILIKE $${values.length})`); }
  const result = await requirePool().query(
    `SELECT m.id,m.event_id,e.name AS event_name,m.round_number,m.stage,m.match_number,
            m.home_team_id,ht.name AS home_team,m.away_team_id,at.name AS away_team,
            m.scheduled_at,m.venue,m.status,m.home_score,m.away_score,m.winner_team_id,m.is_locked
       FROM matches m JOIN events e ON e.id=m.event_id
       LEFT JOIN teams ht ON ht.id=m.home_team_id LEFT JOIN teams at ON at.id=m.away_team_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY m.scheduled_at NULLS LAST,m.round_number,m.match_number LIMIT 500`, values,
  );
  res.json({ items: result.rows });
});

router.post('/matches', requireAuth, adminsAndOrganizers, async (req, res) => {
  const eventId = req.body?.eventId;
  const homeTeamId = req.body?.homeTeamId;
  const awayTeamId = req.body?.awayTeamId;
  const id = newId();
  await withTransaction(async (client) => {
    await ensureEvent(client,eventId);
    const teams = await client.query('SELECT id FROM teams WHERE event_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL', [eventId,[homeTeamId,awayTeamId]]);
    if (!validUuid(homeTeamId) || !validUuid(awayTeamId) || homeTeamId===awayTeamId || teams.rowCount!==2) throw fail(400,'invalid_teams','Pumili ng dalawang magkaibang team mula sa event.');
    await client.query(
      `INSERT INTO matches(id,event_id,round_number,stage,match_number,home_team_id,away_team_id,scheduled_at,venue,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id,eventId,Math.max(1,Number(req.body?.roundNumber)||1),optionalText(req.body?.stage,'stage',80),Math.max(1,Number(req.body?.matchNumber)||1),homeTeamId,awayTeamId,toDateOrNull(req.body?.scheduledAt,'match date/time'),optionalText(req.body?.venue,'venue',180),req.user.id],
    );
    await writeAudit(client,{actorId:req.user.id,action:'match.created',entity:'match',entityId:id,changes:{eventId,homeTeamId,awayTeamId}});
    await publishChange(client,'matches',id);
  });
  res.status(201).json({id,eventId,homeTeamId,awayTeamId,status:'upcoming'});
});

router.patch('/matches/:matchId/schedule', requireAuth, adminsAndOrganizers, async (req, res) => {
  const result = await withTransaction(async (client) => {
    const selected = await client.query('SELECT * FROM matches WHERE id=$1 FOR UPDATE', [req.params.matchId]);
    if (!selected.rowCount) throw fail(404,'not_found','Hindi makita ang match.');
    const match = selected.rows[0];
    if (match.is_locked) throw fail(409,'match_locked','Naka-lock ang official match record.');
    const scheduledAt = req.body?.scheduledAt === undefined ? match.scheduled_at : toDateOrNull(req.body.scheduledAt,'match date/time');
    const venue = req.body?.venue === undefined ? match.venue : optionalText(req.body.venue,'venue',180);
    const updated = await client.query('UPDATE matches SET scheduled_at=$1,venue=$2,updated_by=$3,updated_at=now() WHERE id=$4 RETURNING *',[scheduledAt,venue,req.user.id,match.id]);
    await writeAudit(client,{actorId:req.user.id,action:'match.schedule_updated',entity:'match',entityId:match.id,changes:{scheduledAt,venue}});
    await publishChange(client,'matches',match.id);
    return updated.rows[0];
  });
  res.json(result);
});

router.patch('/matches/:matchId/score', requireAuth, adminsAndOrganizers, async (req, res) => {
  const homeScore = Number(req.body?.homeScore);
  const awayScore = Number(req.body?.awayScore);
  if (!Number.isSafeInteger(homeScore) || homeScore < 0 || homeScore > 1_000_000 || !Number.isSafeInteger(awayScore) || awayScore < 0 || awayScore > 1_000_000) throw fail(400,'invalid_score','Gumamit ng whole-number score na hindi bababa sa zero.');
  const updated = await withTransaction(async (client) => {
    const selected = await client.query('SELECT * FROM matches WHERE id=$1 FOR UPDATE',[req.params.matchId]);
    if (!selected.rowCount) throw fail(404,'not_found','Hindi makita ang match.');
    const match = selected.rows[0];
    if (match.is_locked || ['bye','cancelled','finished'].includes(match.status)) throw fail(409,'match_not_editable','Hindi maaaring baguhin ang score ng match na ito.');
    const result = await client.query(
      `UPDATE matches SET home_score=$1,away_score=$2,status='ongoing',updated_by=$3,updated_at=now()
       WHERE id=$4 RETURNING *`,[homeScore,awayScore,req.user.id,match.id],
    );
    await writeAudit(client,{actorId:req.user.id,action:'match.score_updated',entity:'match',entityId:match.id,changes:{homeScore,awayScore}});
    await publishChange(client,'scores',match.id);
    return result.rows[0];
  });
  res.json(updated);
});

router.patch('/matches/:matchId/status', requireAuth, adminsAndOrganizers, async (req, res) => {
  const status = req.body?.status;
  if (!['upcoming','ongoing','finished','cancelled'].includes(status)) throw fail(400,'invalid_status','Hindi wastong match status.');
  const updated = await withTransaction(async (client) => {
    const selected = await client.query(`SELECT m.*,e.event_format FROM matches m JOIN events e ON e.id=m.event_id WHERE m.id=$1 FOR UPDATE`,[req.params.matchId]);
    if (!selected.rowCount) throw fail(404,'not_found','Hindi makita ang match.');
    const match = selected.rows[0];
    if (match.is_locked || match.status==='bye') throw fail(409,'match_locked','Naka-lock ang official match record.');
    let winnerId = null;
    if (status==='finished') {
      if (!match.home_team_id || !match.away_team_id) throw fail(409,'teams_not_assigned','Hindi pa kumpleto ang mga team sa match na ito.');
      if (match.home_score===match.away_score && match.event_format==='single_elimination') throw fail(409,'tied_elimination_match','Kailangang may malinaw na panalo para sa elimination match.');
      if (match.home_score>match.away_score) winnerId=match.home_team_id;
      if (match.away_score>match.home_score) winnerId=match.away_team_id;
    }
    const result = await client.query('UPDATE matches SET status=$1,winner_team_id=$2,updated_by=$3,updated_at=now() WHERE id=$4 RETURNING *',[status,winnerId,req.user.id,match.id]);
    await writeAudit(client,{actorId:req.user.id,action:'match.status_updated',entity:'match',entityId:match.id,changes:{status,winnerTeamId:winnerId}});
    await publishChange(client,'matches',match.id);
    return result.rows[0];
  });
  res.json(updated);
});

router.post('/matches/:matchId/lock', requireAuth, adminsAndOrganizers, async (req, res) => {
  const updated = await withTransaction(async (client) => {
    const selected = await client.query(`SELECT m.*,e.event_format FROM matches m JOIN events e ON e.id=m.event_id WHERE m.id=$1 FOR UPDATE`,[req.params.matchId]);
    if (!selected.rowCount) throw fail(404,'not_found','Hindi makita ang match.');
    const match = selected.rows[0];
    if (match.status!=='finished' || match.is_locked) throw fail(409,'match_not_ready_to_lock','I-finish muna ang match at tiyaking hindi pa ito naka-lock.');
    if (match.event_format==='single_elimination' && !match.winner_team_id) throw fail(409,'winner_required','Kailangan ng panalo bago i-lock ang elimination match.');
    const result = await client.query('UPDATE matches SET is_locked=true,locked_at=now(),updated_by=$1,updated_at=now() WHERE id=$2 RETURNING *',[req.user.id,match.id]);
    if (match.next_match_id && match.winner_team_id) {
      const child = await client.query('SELECT * FROM matches WHERE id=$1 FOR UPDATE',[match.next_match_id]);
      if (!child.rowCount) throw fail(409,'bracket_next_match_missing','Hindi makita ang susunod na bracket slot.');
      const column = match.next_slot==='home' ? 'home_team_id' : 'away_team_id';
      const occupant = child.rows[0][column];
      if (occupant && occupant!==match.winner_team_id) throw fail(409,'bracket_slot_occupied','May ibang team na nakatalaga na sa bracket slot.');
      await client.query(`UPDATE matches SET ${column}=$1,updated_at=now() WHERE id=$2`,[match.winner_team_id,child.rows[0].id]);
    }
    await writeAudit(client,{actorId:req.user.id,action:'match.finalized_and_locked',entity:'match',entityId:match.id,changes:{winnerTeamId:match.winner_team_id,homeScore:match.home_score,awayScore:match.away_score}});
    const openMatches = await client.query(`SELECT count(*)::int AS count FROM matches WHERE event_id=$1 AND status NOT IN ('bye','cancelled') AND (status<>'finished' OR is_locked=false)`,[match.event_id]);
    if (openMatches.rows[0].count===0) {
      await client.query(`UPDATE events SET status='completed',updated_at=now() WHERE id=$1`,[match.event_id]);
      await writeAudit(client,{actorId:req.user.id,action:'event.completed',entity:'event',entityId:match.event_id});
    }
    await publishChange(client,'matches',match.id);
    return result.rows[0];
  });
  res.json({ ...updated, message: 'Na-finalize at naka-lock ang official match result.' });
});

router.get('/standings', requireAuth, async (req, res) => {
  const eventId = req.query.eventId && validUuid(req.query.eventId) ? req.query.eventId : null;
  const result = await requirePool().query(
    `WITH awards AS (
       SELECT team_id, event_id, sum(points)::int AS points
         FROM event_awards GROUP BY team_id,event_id
     ), wins AS (
       SELECT t.id AS team_id, count(m.id) FILTER (WHERE m.winner_team_id=t.id)::int AS wins
         FROM teams t LEFT JOIN matches m ON m.event_id=t.event_id AND m.status='finished' AND m.is_locked=true
          AND (m.home_team_id=t.id OR m.away_team_id=t.id)
        GROUP BY t.id
     ), rows AS (
       SELECT t.id AS team_id,t.name AS team_name,t.event_id,e.name AS event_name,
              COALESCE(a.points,0)::int AS points,COALESCE(w.wins,0)::int AS wins
         FROM teams t JOIN events e ON e.id=t.event_id
         LEFT JOIN awards a ON a.team_id=t.id AND a.event_id=t.event_id
         LEFT JOIN wins w ON w.team_id=t.id
        WHERE t.deleted_at IS NULL AND ($1::uuid IS NULL OR t.event_id=$1)
     )
     SELECT team_id,team_name,event_id,event_name,points,wins,
            rank() OVER (PARTITION BY event_id ORDER BY points DESC)::int AS rank
       FROM rows ORDER BY event_name,rank,team_name`,[eventId],
  );
  res.json({ items: result.rows });
});

router.get('/admin/medal-points', requireAuth, requireRoles('admin'), async (_req, res) => {
  const result = await requirePool().query('SELECT medal,points,updated_at FROM medal_points ORDER BY CASE medal WHEN \'gold\' THEN 1 WHEN \'silver\' THEN 2 ELSE 3 END');
  res.json({ items: result.rows });
});

router.patch('/admin/medal-points', requireAuth, requireRoles('admin'), async (req, res) => {
  const values = req.body?.points;
  if (!values || !['gold','silver','bronze'].every((medal) => Number.isSafeInteger(values[medal]) && values[medal]>=0 && values[medal]<=100)) throw fail(400,'invalid_points','Ibigay ang whole-number points na 0–100 para sa gold, silver at bronze.');
  const result = await withTransaction(async (client) => {
    for (const medal of ['gold','silver','bronze']) {
      await client.query('UPDATE medal_points SET points=$1,updated_by=$2,updated_at=now() WHERE medal=$3',[values[medal],req.user.id,medal]);
    }
    await client.query('UPDATE event_awards AS a SET points=p.points FROM medal_points AS p WHERE a.medal=p.medal');
    await writeAudit(client,{actorId:req.user.id,action:'leaderboard.medal_points_updated',entity:'settings',entityId:'medal_points',changes:values});
    await publishChange(client,'standings','all');
    return client.query('SELECT medal,points FROM medal_points ORDER BY CASE medal WHEN \'gold\' THEN 1 WHEN \'silver\' THEN 2 ELSE 3 END');
  });
  res.json({ items: result.rows });
});

router.post('/events/:eventId/awards', requireAuth, adminsAndOrganizers, async (req, res) => {
  const teamId = req.body?.teamId;
  const medal = req.body?.medal;
  if (!validUuid(teamId) || !medals.has(medal)) throw fail(400,'invalid_award','Pumili ng wastong team at gold, silver o bronze.');
  const result = await withTransaction(async (client) => {
    const event = await ensureEvent(client,req.params.eventId);
    const ready = await client.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status IN ('finished','bye','cancelled') AND (status='bye' OR is_locked=true))::int AS done FROM matches WHERE event_id=$1`,[event.id]);
    if (ready.rows[0].total===0 || ready.rows[0].done!==ready.rows[0].total) throw fail(409,'event_not_final','I-finalize at i-lock muna ang lahat ng match bago magtala ng medal award.');
    const team = await client.query('SELECT id FROM teams WHERE id=$1 AND event_id=$2 AND deleted_at IS NULL',[teamId,event.id]);
    if (!team.rowCount) throw fail(404,'team_not_found','Hindi kabilang ang team sa event na ito.');
    const points = await client.query('SELECT points FROM medal_points WHERE medal=$1',[medal]);
    const saved = await client.query(
      `INSERT INTO event_awards(event_id,team_id,medal,points,awarded_by)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(event_id,team_id) DO UPDATE SET medal=EXCLUDED.medal,points=EXCLUDED.points,awarded_by=EXCLUDED.awarded_by,awarded_at=now()
       RETURNING *`,[event.id,teamId,medal,points.rows[0].points,req.user.id],
    );
    await writeAudit(client,{actorId:req.user.id,action:'team.medal_awarded',entity:'team',entityId:teamId,changes:{eventId:event.id,medal,points:points.rows[0].points}});
    await publishChange(client,'standings',event.id);
    return saved.rows[0];
  });
  res.status(201).json(result);
});

router.get('/announcements', requireAuth, async (req, res) => {
  const result = await requirePool().query(
    `SELECT id,title,content,target_audience,created_by,created_at,updated_at
       FROM announcements WHERE deleted_at IS NULL
        AND (target_audience @> ARRAY['all']::text[] OR target_audience @> ARRAY[$1]::text[])
      ORDER BY created_at DESC LIMIT 500`,[req.user.role],
  );
  res.json({ items: result.rows });
});

router.post('/announcements', requireAuth, adminsAndOrganizers, async (req, res) => {
  const title = requiredText(req.body?.title,'Pamagat',180);
  const content = requiredText(req.body?.content,'Nilalaman',10000);
  const targetAudience = req.body?.targetAudience ?? ['all'];
  if (!Array.isArray(targetAudience) || !targetAudience.length || targetAudience.some((role) => role!=='all' && !roles.has(role))) throw fail(400,'invalid_audience','Hindi wastong target audience.');
  const id = newId();
  await withTransaction(async (client) => {
    await client.query('INSERT INTO announcements(id,title,content,target_audience,created_by) VALUES($1,$2,$3,$4,$5)',[id,title,content,[...new Set(targetAudience)],req.user.id]);
    await writeAudit(client,{actorId:req.user.id,action:'announcement.created',entity:'announcement',entityId:id,changes:{title,targetAudience}});
    await publishChange(client,'announcements',id);
  });
  res.status(201).json({id,title,content,targetAudience,createdBy:req.user.id});
});

router.patch('/announcements/:announcementId', requireAuth, adminsAndOrganizers, async (req, res) => {
  const result = await withTransaction(async (client) => {
    const current = await client.query('SELECT * FROM announcements WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[req.params.announcementId]);
    if (!current.rowCount) throw fail(404,'not_found','Hindi makita ang announcement.');
    const row = current.rows[0];
    const title = req.body?.title === undefined ? row.title : requiredText(req.body.title,'Pamagat',180);
    const content = req.body?.content === undefined ? row.content : requiredText(req.body.content,'Nilalaman',10000);
    const targetAudience = req.body?.targetAudience === undefined ? row.target_audience : req.body.targetAudience;
    if (!Array.isArray(targetAudience) || !targetAudience.length || targetAudience.some((role) => role!=='all' && !roles.has(role))) throw fail(400,'invalid_audience','Hindi wastong target audience.');
    const updated = await client.query('UPDATE announcements SET title=$1,content=$2,target_audience=$3,updated_at=now() WHERE id=$4 RETURNING *',[title,content,[...new Set(targetAudience)],row.id]);
    await writeAudit(client,{actorId:req.user.id,action:'announcement.updated',entity:'announcement',entityId:row.id,changes:{title,targetAudience}});
    await publishChange(client,'announcements',row.id);
    return updated.rows[0];
  });
  res.json(result);
});

router.delete('/announcements/:announcementId', requireAuth, adminsAndOrganizers, async (req, res) => {
  await withTransaction(async (client) => {
    const result = await client.query('UPDATE announcements SET deleted_at=now(),updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id',[req.params.announcementId]);
    if (!result.rowCount) throw fail(404,'not_found','Hindi makita ang announcement.');
    await writeAudit(client,{actorId:req.user.id,action:'announcement.archived',entity:'announcement',entityId:result.rows[0].id});
    await publishChange(client,'announcements',result.rows[0].id);
  });
  res.json({ok:true});
});

router.get('/community', requireAuth, async (req, res) => {
  const result = await requirePool().query(
    `SELECT p.id,p.event_id,p.author_id,p.caption,p.photo_key,p.attendance_status,p.reviewed_by,p.reviewed_at,p.review_note,p.created_at,
            u.full_name AS author_name,e.name AS event_name
       FROM community_posts p JOIN users u ON u.id=p.author_id LEFT JOIN events e ON e.id=p.event_id
      WHERE p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT 200`,
  );
  res.json({ items: result.rows.map((row) => ({ ...row, photoUrl: `/manus-storage/${row.photo_key}` })) });
});

router.post('/community/posts', requireAuth, requireRoles('student'), async (req, res) => {
  const caption = optionalText(req.body?.caption,'caption',2000);
  const eventId = req.body?.eventId || null;
  const photoKey = requiredText(req.body?.photoKey,'photo key',512);
  if (!photoKey.startsWith(`intranexus/nexsocial/${req.user.id}/`)) throw fail(403,'invalid_photo_owner','Hindi pag-aari ng account na ito ang uploaded na larawan.');
  const id = newId();
  await withTransaction(async (client) => {
    if (eventId) await ensureEvent(client,eventId);
    const upload = await client.query(
      `SELECT photo_key FROM community_upload_intents
        WHERE photo_key=$1 AND user_id=$2 AND expires_at>now() AND consumed_at IS NULL FOR UPDATE`,
      [photoKey, req.user.id],
    );
    if (!upload.rowCount) throw fail(409,'upload_intent_invalid','Wala, expired o nagamit na ang secure upload authorization. Mag-upload muli ng larawan.');
    await client.query('INSERT INTO community_posts(id,event_id,author_id,caption,photo_key) VALUES($1,$2,$3,$4,$5)',[id,eventId,req.user.id,caption,photoKey]);
    await client.query('UPDATE community_upload_intents SET consumed_at=now() WHERE photo_key=$1',[photoKey]);
    await writeAudit(client,{actorId:req.user.id,action:'community.post_created',entity:'community_post',entityId:id,changes:{eventId,attendanceStatus:'pending'}});
    await publishChange(client,'community',id);
  });
  res.status(201).json({id,eventId,caption,photoKey,photoUrl:`/manus-storage/${photoKey}`,attendanceStatus:'pending'});
});

router.patch('/community/posts/:postId/review', requireAuth, requireRoles('admin','organizer','teacher'), async (req, res) => {
  const status = req.body?.status;
  if (!['approved','rejected'].includes(status)) throw fail(400,'invalid_status','Pumili ng approved o rejected attendance evidence.');
  const note = optionalText(req.body?.note,'review note',500);
  const result = await withTransaction(async (client) => {
    const post = await client.query('SELECT * FROM community_posts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[req.params.postId]);
    if (!post.rowCount) throw fail(404,'not_found','Hindi makita ang community post.');
    if (req.user.role==='teacher' && post.rows[0].event_id) {
      const leadership = await client.query('SELECT 1 FROM teams WHERE event_id=$1 AND camp_leader_id=$2 AND deleted_at IS NULL LIMIT 1',[post.rows[0].event_id,req.user.id]);
      if (!leadership.rowCount) throw fail(403,'forbidden','Maaari lamang mag-validate ang Teacher sa event ng camp na pinamumunuan niya.');
    }
    const updated = await client.query('UPDATE community_posts SET attendance_status=$1,reviewed_by=$2,reviewed_at=now(),review_note=$3 WHERE id=$4 RETURNING *',[status,req.user.id,note,req.params.postId]);
    await writeAudit(client,{actorId:req.user.id,action:'attendance.photo_reviewed',entity:'community_post',entityId:req.params.postId,changes:{status,note}});
    await publishChange(client,'community',req.params.postId);
    return updated.rows[0];
  });
  res.json(result);
});

router.get('/admin/users', requireAuth, requireRoles('admin'), async (_req, res) => {
  const result = await requirePool().query(`SELECT id,full_name,email,role,account_status,created_at FROM users WHERE account_status='pending' ORDER BY created_at`);
  res.json({ items: result.rows });
});

router.patch('/admin/users/:userId/decision', requireAuth, requireRoles('admin'), async (req, res) => {
  const status = req.body?.status;
  if (!['approved','rejected'].includes(status)) throw fail(400,'invalid_decision','Pumili ng approved o rejected.');
  const result = await withTransaction(async (client) => {
    const current = await client.query(`SELECT id,role,account_status FROM users WHERE id=$1 FOR UPDATE`,[req.params.userId]);
    if (!current.rowCount) throw fail(404,'not_found','Hindi makita ang account.');
    if (current.rows[0].role==='admin') throw fail(409,'admin_review_protected','Hindi maaaring baguhin ang admin access sa registration review.');
    const updated = await client.query(`UPDATE users SET account_status=$1,approved_at=CASE WHEN $1='approved' THEN now() ELSE NULL END,approved_by=$2,updated_at=now() WHERE id=$3 RETURNING id,full_name,email,role,account_status,created_at`,[status,req.user.id,req.params.userId]);
    await writeAudit(client,{actorId:req.user.id,action:`account.${status}`,entity:'user',entityId:req.params.userId,changes:{status}});
    await publishChange(client,'users',req.params.userId);
    return updated.rows[0];
  });
  res.json(result);
});

export default router;
