const API = '/api';
const routePatterns = [
  { pattern: /^\/$/, key: 'home' },
  { pattern: /^\/signIn\/?$/, key: 'signIn' },
  { pattern: /^\/register\/?$/, key: 'register' },
  { pattern: /^\/dashboard\/?$/, key: 'dashboard' },
  { pattern: /^\/events\/?$/, key: 'events' },
  { pattern: /^\/events\/([^/]+)\/?$/, key: 'eventDetail' },
  { pattern: /^\/matches\/?$/, key: 'matches' },
  { pattern: /^\/teams\/?$/, key: 'teams' },
  { pattern: /^\/teams\/([^/]+)\/?$/, key: 'teamDetail' },
  { pattern: /^\/leaderboard\/?$/, key: 'leaderboard' },
  { pattern: /^\/announcements\/?$/, key: 'announcements' },
  { pattern: /^\/community\/?$/, key: 'community' },
  { pattern: /^\/admin\/users\/?$/, key: 'adminUsers' },
  { pattern: /^\/profile\/?$/, key: 'profile' },
];
const pageInfo = {
  dashboard: ['Dashboard', 'Your intramural hub.'], events: ['Events', 'Explore tournament events.'],
  eventDetail: ['Event details', 'Event information and bracket.'], matches: ['Matches', 'Schedules and official results.'],
  teams: ['Teams', 'Teams and player lineups.'], teamDetail: ['Team details', 'Team information.'],
  leaderboard: ['Leaderboard', 'Standings and medal points.'], announcements: ['Announcements', 'Updates from your organizers.'],
  community: ['NexSocial', 'Community and attendance evidence.'], adminUsers: ['User approvals', 'Review account access.'], profile: ['Profile', 'Your account details.'],
};
const navItems = [
  { label: 'Dashboard', href: '/dashboard', icon: '⌂', roles: ['Admin', 'Committee/Organizer', 'Teacher', 'Student'] },
  { label: 'Events', href: '/events', icon: '◫', roles: ['Admin', 'Committee/Organizer', 'Teacher', 'Student'] },
  { label: 'Matches', href: '/matches', icon: '◷', roles: ['Admin', 'Committee/Organizer', 'Teacher', 'Student'] },
  { label: 'Teams', href: '/teams', icon: '♧', roles: ['Admin', 'Committee/Organizer', 'Teacher', 'Student'] },
  { label: 'Leaderboard', href: '/leaderboard', icon: '↗', roles: ['Admin', 'Committee/Organizer', 'Teacher', 'Student'] },
  { label: 'Announcements', href: '/announcements', icon: '▤', roles: ['Admin', 'Committee/Organizer', 'Teacher', 'Student'] },
  { label: 'NexSocial', href: '/community', icon: '◎', roles: ['Admin', 'Committee/Organizer', 'Teacher', 'Student'] },
  { label: 'User approvals', href: '/admin/users', icon: '⚙', roles: ['Admin'] },
];
const collections = { events: 'events', matches: 'matches', teams: 'teams', leaderboard: 'standings', announcements: 'announcements', community: 'community' };
const descriptions = {
  events: 'Browse intramural events and their details.', matches: 'Match schedules, statuses and official results.',
  teams: 'Team information, camp leaders and eligible rosters.', leaderboard: 'Standings calculated from official results.',
  announcements: 'Notices and updates from your organizers.', community: 'Community posts and attendance evidence.',
};
let session = null;
let csrfToken = null;
let apiState = 'pending';
let apiNote = '';
let realtimeSource = null;
let pendingLiveRefresh = false;
const scoreTimers = new WeakMap();
const app = document.querySelector('#app');

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers });
  let data = {};
  try { data = await response.json(); } catch { /* Empty or non-JSON response. */ }
  if (!response.ok) {
    const error = new Error(data.message || `Request failed (${response.status}).`);
    error.status = response.status;
    error.code = data.error;
    throw error;
  }
  return data;
}

async function refreshSession() {
  try {
    const data = await request(`${API}/session`);
    session = data.user || null;
    csrfToken = null;
    if (data.databaseConfigured === false) {
      apiState = 'offline';
      apiNote = 'PostgreSQL connection setup is on hold. Authentication and tournament data will become available after the connection is added.';
    } else {
      apiState = 'ready';
      apiNote = '';
    }
  } catch {
    session = null;
    apiState = 'offline';
    apiNote = 'The application service is not available right now. Please try again later.';
  }
}

async function getCsrf() {
  if (csrfToken) return csrfToken;
  const data = await request(`${API}/csrf`);
  csrfToken = data.csrfToken;
  return csrfToken;
}

async function mutate(path, method, body) {
  const token = await getCsrf();
  return request(path, {
    method,
    headers: { 'X-CSRF-Token': token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function currentRoute(path = location.pathname) {
  for (const route of routePatterns) {
    const match = path.match(route.pattern);
    if (match) return { ...route, params: match.slice(1) };
  }
  return { key: 'notFound', params: [] };
}
function go(path) { history.pushState({}, '', path); void render(); }
function esc(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}
function isoDate(value) {
  if (!value) return 'Not scheduled';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? esc(value) : date.toLocaleString();
}
function isStaff() { return ['Admin', 'Committee/Organizer', 'Teacher'].includes(session?.role); }
function isOrganizer() { return ['Admin', 'Committee/Organizer'].includes(session?.role); }
function connectionBanner() {
  return `<div class="status-banner" role="status"><span class="status-dot" aria-hidden="true"></span><div><strong>${apiState === 'offline' ? 'Waiting for PostgreSQL setup' : 'Application service connected'}</strong><p>${esc(apiState === 'offline' ? apiNote : 'Live tournament data is shown from the connected service.')}</p></div></div>`;
}
function pageHeader(title, description, action = '') {
  return `<div class="page-heading"><div><span class="eyebrow">INTRANEXUS</span><h1>${esc(title)}</h1><p>${esc(description)}</p></div>${action}</div>`;
}
function empty(title, detail) {
  return `<div class="empty-state"><span class="empty-symbol" aria-hidden="true">◌</span><strong>${esc(title)}</strong><p>${esc(detail)}</p></div>`;
}
function brand() {
  return `<a class="wordmark" href="/dashboard" data-link><span class="brand-mark" aria-hidden="true">N</span><span>INTRANEXUS<small>STI COLLEGE MALOLOS</small></span></a>`;
}
function authNotice() {
  return `<div class="form-feedback feedback-info" role="status">${esc(apiNote || 'Authentication is waiting for PostgreSQL setup.')}</div>`;
}
function authPage(register = false) {
  const title = register ? 'Create your account' : 'Welcome back!';
  return `<div class="auth-page"><aside class="auth-aside">${brand()}<div class="auth-intro"><span class="eyebrow">Your campus tournament hub</span><h1>Every match.<br>One community.</h1><p>Schedules, results, team updates and campus tournament moments — together in one place.</p></div><div class="auth-foot">For STI College Malolos intramurals</div></aside><main id="main" class="auth-panel-wrap"><section class="auth-card" aria-labelledby="auth-title"><h2 id="auth-title">${title}</h2><p class="subhead">${register ? 'Register to request access to the intramural hub.' : 'Sign in to continue to your intramural hub.'}</p>${apiState === 'offline' ? authNotice() : ''}<form id="${register ? 'register-form' : 'login-form'}" novalidate>${register ? `<div class="field"><label for="fullName">Full name</label><input id="fullName" name="fullName" autocomplete="name" required maxlength="120" placeholder="Your full name"></div>` : ''}<div class="field"><label for="email">STI email</label><input id="email" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com"></div><div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" required minlength="${register ? '10' : '1'}" maxlength="256" placeholder="${register ? 'At least 10 characters' : 'Enter your password'}"></div>${register ? `<div class="field"><label for="role">Role requested</label><select id="role" name="role" required><option value="" selected disabled>Select a role</option><option value="student">Student</option><option value="teacher">Teacher</option><option value="organizer">Committee/Organizer</option></select><span class="field-hint">New registrations require administrator review. Admin accounts are created through a protected setup process.</span></div>` : `<div class="auth-options"><span>Use your registered STI email</span></div>`}<div id="form-feedback" aria-live="polite"></div><button class="btn btn-primary" type="submit">${register ? 'Request access' : 'Sign in'} <span aria-hidden="true">→</span></button></form><p class="auth-switch">${register ? 'Already have an account?' : 'New to Intranexus?'} <a class="text-link" href="${register ? '/signIn' : '/register'}" data-link>${register ? 'Sign in' : 'Create an account'}</a></p></section></main></div>`;
}
function visibleNav(role) { return navItems.filter((item) => item.roles.includes(role || 'Student')); }
function navMarkup(role, active) {
  return visibleNav(role).map((item) => `<a class="nav-link ${active === item.href ? 'active' : ''}" href="${item.href}" data-link aria-current="${active === item.href ? 'page' : 'false'}"><span class="nav-icon" aria-hidden="true">${item.icon}</span><span>${item.label}</span></a>`).join('');
}
function mobileNavMarkup(role, active) {
  const items = visibleNav(role);
  const primaryPaths = ['/dashboard', '/events', '/matches', '/teams', '/community'];
  const primary = items.filter((item) => primaryPaths.includes(item.href));
  const more = items.filter((item) => !primaryPaths.includes(item.href));
  const profileActive = active === '/profile';
  const links = (entries) => entries.map((item) => `<a class="nav-link ${active === item.href ? 'active' : ''}" href="${item.href}" data-link><span class="nav-icon" aria-hidden="true">${item.icon}</span><span>${item.label}</span></a>`).join('');
  return `<div class="mobile-nav-primary">${links(primary)}<button type="button" class="nav-link mobile-more-toggle ${more.some((item) => item.href === active) || profileActive ? 'active' : ''}" data-action="toggle-more" aria-expanded="false" aria-controls="mobile-more"><span class="nav-icon" aria-hidden="true">⋯</span><span>More</span></button></div><div class="mobile-more" id="mobile-more" hidden>${links(more)}<a class="nav-link ${profileActive ? 'active' : ''}" href="/profile" data-link><span class="nav-icon" aria-hidden="true">◉</span><span>Profile</span></a></div>`;
}
function shell(content, route) {
  const user = session || {};
  const name = user.fullName || 'Signed-in user';
  const role = user.role || 'Student';
  let active = location.pathname;
  if (route.key === 'eventDetail') active = '/events';
  if (route.key === 'teamDetail') active = '/teams';
  return `<div class="app-shell"><aside class="sidebar">${brand()}<div class="nav-label">Workspace</div><nav class="nav-list" aria-label="Main navigation">${navMarkup(role, active)}</nav><div class="sidebar-bottom"><div class="user-chip"><span class="avatar" aria-hidden="true">${esc((name.trim()[0] || 'U').toUpperCase())}</span><span><strong>${esc(name)}</strong><small>${esc(role)}</small></span></div><a class="nav-link" href="/profile" data-link><span class="nav-icon" aria-hidden="true">◉</span><span>Profile</span></a><button type="button" class="nav-link logout-btn" data-action="logout"><span class="nav-icon" aria-hidden="true">↪</span><span>Sign out</span></button></div></aside><div class="main-area"><header class="mobile-header">${brand()}<button class="nav-link logout-btn" data-action="logout" aria-label="Sign out">↪</button></header><header class="topbar"><span class="topbar-title">${esc(pageInfo[route.key]?.[0] || 'Intranexus')}</span><span class="topbar-meta">${esc(role)} workspace</span></header><main id="main" class="content">${content}</main></div><nav class="mobile-nav" aria-label="Mobile navigation">${mobileNavMarkup(role, active)}</nav></div>`;
}
async function load(path) { return request(`${API}/${path}`); }
function errorPanel(message) { return `<div class="route-error" role="alert">${esc(message)}</div>`; }
function itemCards(items, renderer, noItems) {
  return items.length ? `<div class="record-list">${items.map(renderer).join('')}</div>` : empty(noItems[0], noItems[1]);
}
function formatStatus(value) { return `<span class="status-chip status-${esc(String(value || 'unknown').toLowerCase())}">${esc(String(value || 'unknown').replaceAll('_', ' '))}</span>`; }
function canManageEvents() { return isOrganizer(); }

function dashboardTools() {
  const tools = [
    ['Events', 'View tournament formats and event details.', '/events', '◫'],
    ['Matches', 'Check schedules, statuses and official scores.', '/matches', '◷'],
    ['Teams', 'View teams, camp leaders and lineups.', '/teams', '♧'],
    ['Leaderboard', 'See standings from official results.', '/leaderboard', '↗'],
    ['Announcements', 'Read updates shared by organizers.', '/announcements', '▤'],
    ['NexSocial', 'Review community posts and attendance proof.', '/community', '◎'],
  ];
  if (session?.role === 'Admin') tools.unshift(['User approvals', 'Review account access requests.', '/admin/users', '⚙']);
  return `<div class="grid-cards">${tools.map(([title, description, href, icon]) => `<a class="feature-card" href="${href}" data-link><div class="feature-top"><span class="feature-icon" aria-hidden="true">${icon}</span><span class="arrow" aria-hidden="true">↗</span></div><h3>${title}</h3><p>${description}</p></a>`).join('')}</div>`;
}
async function dashboardPage() {
  let summary;
  try { summary = await load('dashboard'); } catch (error) { return `${pageHeader('Dashboard', 'A clear view of the tournament.')}${connectionBanner()}${errorPanel(error.message)}`; }
  const matches = summary.upcomingMatches || [];
  const announcements = summary.announcements || [];
  const tiles = `<div class="data-grid"><div class="data-tile"><span>Active events</span><strong>${Number(summary.activeEventCount) || 0}</strong></div><div class="data-tile"><span>Upcoming matches</span><strong>${matches.length}</strong></div><div class="data-tile"><span>Announcements</span><strong>${announcements.length}</strong></div></div>`;
  const matchList = itemCards(matches, (match) => `<article class="record-card"><div class="record-heading"><strong>${esc(match.home_team || 'TBD')} <span class="score">${Number(match.home_score) || 0} — ${Number(match.away_score) || 0}</span> ${esc(match.away_team || 'TBD')}</strong>${formatStatus(match.status)}</div><p>${esc(match.event_name || 'Intramural event')} · ${esc(isoDate(match.scheduled_at))}${match.venue ? ` · ${esc(match.venue)}` : ''}</p></article>`, ['No upcoming matches', 'Schedules will appear here once an organizer publishes them.']);
  const announcementList = itemCards(announcements, (item) => `<article class="record-card"><strong>${esc(item.title)}</strong><p>${esc(item.content)}</p><small>${esc(isoDate(item.created_at))}</small></article>`, ['No announcements yet', 'New notices from organizers will appear here.']);
  return `${pageHeader('Dashboard', 'Your intramural hub and current tournament updates.')}${connectionBanner()}${tiles}<h2 class="section-title">Upcoming matches</h2>${matchList}<h2 class="section-title">Recent announcements</h2>${announcementList}<h2 class="section-title">Your workspace</h2>${dashboardTools()}`;
}
function eventCard(event) {
  return `<a class="record-card record-link" href="/events/${encodeURIComponent(event.id)}" data-link><div class="record-heading"><strong>${esc(event.name)}</strong>${formatStatus(event.status)}</div><p>${esc(event.category)} · ${esc(event.event_format?.replaceAll('_', ' ') || '')} · ${esc(event.venue || 'Venue not set')}</p><div class="record-meta"><span>${esc(isoDate(event.starts_at))}</span><span>${Number(event.team_count) || 0} teams</span><span>${Number(event.match_count) || 0} matches</span></div></a>`;
}
function createEventForm() {
  return `<details id="create-event" class="content-card form-disclosure"><summary>Create event</summary><form class="app-form" data-form="create-event"><div class="form-grid"><div class="field"><label for="eventName">Event name</label><input id="eventName" name="name" required maxlength="140"></div><div class="field"><label for="eventCategory">Category</label><select id="eventCategory" name="category"><option value="sports">Sports</option><option value="esports">Esports</option></select></div><div class="field"><label for="eventStart">Start date/time</label><input id="eventStart" name="startsAt" type="datetime-local"></div><div class="field"><label for="eventVenue">Venue</label><input id="eventVenue" name="venue" maxlength="180"></div></div><div class="field"><label for="eventDescription">Description</label><textarea id="eventDescription" name="description" maxlength="3000"></textarea></div><button class="btn" type="submit">Save event</button><p class="field-hint">Sports use round-robin fixtures; esports use single-elimination. The format is selected from the category.</p></form></details>`;
}
async function eventsPage() {
  let response;
  try { response = await load('events'); } catch (error) { return `${pageHeader('Events', descriptions.events)}${connectionBanner()}${errorPanel(error.message)}`; }
  const items = response.items || [];
  return `${pageHeader('Events', descriptions.events, canManageEvents() ? '<a class="btn btn-quiet" href="#create-event">Create event</a>' : '')}${connectionBanner()}${canManageEvents() ? createEventForm() : ''}${itemCards(items, eventCard, ['No events yet', 'An Admin or Committee/Organizer can create the first event.'])}`;
}
async function eventDetailPage(id) {
  let result;
  try { result = await load(`events/${encodeURIComponent(id)}`); } catch (error) { return `${pageHeader('Event details', 'Event teams, matches and bracket.')}${connectionBanner()}${errorPanel(error.message)}`; }
  const event = result.event;
  const teams = result.teams || [];
  const matches = result.matches || [];
  const teamRows = itemCards(teams, (team) => `<article class="record-card"><strong>${esc(team.name)}</strong><p>${esc(team.category || 'Team')} · Camp leader: ${esc(team.camp_leader || 'Not assigned')}</p><a class="text-link" href="/teams/${encodeURIComponent(team.id)}" data-link>View lineup</a></article>`, ['No teams in this event', 'Add teams before generating fixtures.']);
  const matchRows = itemCards(matches, matchCard, ['No matches generated', 'Review participating teams, then generate the tournament bracket.']);
  const generate = canManageEvents() && event.generation_confirmed_at == null && !matches.length
    ? `<button class="btn" type="button" data-action="generate-bracket" data-id="${esc(event.id)}" data-name="${esc(event.name)}" data-format="${esc(event.event_format)}" data-team-count="${teams.length}">Review summary and generate bracket</button>` : '';
  const awardForm = canManageEvents() && event.status === 'completed' && teams.length
    ? `<form class="inline-form" data-form="award-team" data-event-id="${esc(event.id)}"><select name="teamId" required>${teams.map((team) => `<option value="${esc(team.id)}">${esc(team.name)}</option>`).join('')}</select><select name="medal" required><option value="gold">Gold</option><option value="silver">Silver</option><option value="bronze">Bronze</option></select><button class="btn" type="submit">Record medal</button></form>` : '';
  return `${pageHeader(event.name, `${event.category} · ${event.event_format?.replaceAll('_', ' ')} · ${event.venue || 'Venue not set'}`)}${connectionBanner()}<div class="detail-facts">${formatStatus(event.status)}<span>${esc(isoDate(event.starts_at))}</span><span>${teams.length} teams</span></div><section class="content-card"><h2 class="section-title">Tournament configuration summary</h2><p>${esc(event.description || 'No event description provided.')}</p><p>Format: <strong>${esc(event.event_format?.replaceAll('_', ' '))}</strong>. Teams: <strong>${teams.length}</strong>. Venue: <strong>${esc(event.venue || 'Not set')}</strong>.</p>${generate}<div id="action-feedback" aria-live="polite"></div></section><h2 class="section-title">Bracket and matches</h2>${matchRows}<h2 class="section-title">Participating teams</h2>${teamRows}${awardForm ? `<h2 class="section-title">Award a medal</h2><section class="content-card">${awardForm}</section>` : ''}`;
}
function matchCard(match) {
  const actions = isOrganizer() && !match.is_locked && !['bye', 'cancelled', 'finished'].includes(match.status)
    ? `<div class="match-actions"><form class="inline-form" data-form="score-match" data-id="${esc(match.id)}"><label>Home<span class="score-stepper"><button type="button" data-score-step="-1" data-score-target="homeScore" aria-label="Decrease home score">−</button><input name="homeScore" type="number" min="0" step="1" value="${Number(match.home_score) || 0}" required><button type="button" data-score-step="1" data-score-target="homeScore" aria-label="Increase home score">+</button></span></label><label>Away<span class="score-stepper"><button type="button" data-score-step="-1" data-score-target="awayScore" aria-label="Decrease away score">−</button><input name="awayScore" type="number" min="0" step="1" value="${Number(match.away_score) || 0}" required><button type="button" data-score-step="1" data-score-target="awayScore" aria-label="Increase away score">+</button></span></label><button class="btn btn-quiet" type="submit">Save score</button></form><div class="action-row"><button class="btn btn-quiet" data-action="finish-match" data-id="${esc(match.id)}" type="button">Mark finished</button>${match.status === 'upcoming' || match.status === 'ongoing' ? `<button class="btn btn-quiet" data-action="schedule-match" data-id="${esc(match.id)}" type="button">Edit schedule</button>` : ''}</div></div>`
    : (isOrganizer() && match.status === 'finished' && !match.is_locked ? `<button class="btn" data-action="lock-match" data-id="${esc(match.id)}" type="button">Finalize and lock result</button>` : '');
  const score = match.status === 'bye' ? 'BYE' : `${Number(match.home_score) || 0} — ${Number(match.away_score) || 0}`;
  return `<article class="record-card"><div class="record-heading"><strong>${esc(match.home_team || 'TBD')} <span class="score" data-score-display>${score}</span> ${esc(match.away_team || 'TBD')}</strong>${formatStatus(match.status)}</div><p>${esc(match.event_name || match.stage || 'Tournament match')} · Round ${Number(match.round_number) || 1} / Match ${Number(match.match_number) || 1}</p><div class="record-meta"><span>${esc(isoDate(match.scheduled_at))}</span><span>${esc(match.venue || 'Venue not set')}</span>${match.is_locked ? '<span class="locked-label">Official result locked</span>' : ''}</div>${actions ? `<div class="record-actions">${actions}</div>` : ''}<div id="feedback-${esc(match.id)}" aria-live="polite"></div></article>`;
}
async function matchesPage() {
  let response;
  try { response = await load('matches'); } catch (error) { return `${pageHeader('Matches', descriptions.matches)}${connectionBanner()}${errorPanel(error.message)}`; }
  const items = response.items || [];
  const filter = `<div class="filter-row"><label class="field"><span>Search teams/events</span><input id="match-search" type="search" placeholder="Search matches"></label><label class="field"><span>Status</span><select id="match-status"><option value="">All statuses</option><option>upcoming</option><option>ongoing</option><option>finished</option><option>bye</option></select></label></div>`;
  return `${pageHeader('Matches', descriptions.matches)}${connectionBanner()}${filter}<div id="match-list">${itemCards(items, matchCard, ['No matches yet', 'Matches will appear after tournament fixtures are generated.'])}</div>`;
}
async function createTeamForm() {
  let events = [];
  let teachers = [];
  try { [events, teachers] = await Promise.all([load('events'), load('users/teachers')]); events = events.items || []; teachers = teachers.items || []; } catch { /* The form explains when no selectable records are available. */ }
  return `<details class="content-card form-disclosure"><summary>Create team/camp</summary><form class="app-form" data-form="create-team"><div class="form-grid"><div class="field"><label>Event</label><select name="eventId" required>${events.map((event) => `<option value="${esc(event.id)}">${esc(event.name)}</option>`).join('')}</select></div><div class="field"><label>Team/camp name</label><input name="name" required maxlength="120"></div><div class="field"><label>Category</label><input name="category" maxlength="100"></div><div class="field"><label>Teacher camp leader</label><select name="campLeaderId"><option value="">Not assigned</option>${teachers.map((teacher) => `<option value="${esc(teacher.id)}">${esc(teacher.full_name || teacher.fullName)}</option>`).join('')}</select></div></div><button class="btn" type="submit" ${events.length ? '' : 'disabled'}>Save team</button>${events.length ? '' : '<p class="field-hint">Create an event first to add its teams.</p>'}</form></details>`;
}
function teamCard(team) {
  return `<a class="record-card record-link" href="/teams/${encodeURIComponent(team.id)}" data-link><div class="record-heading"><strong>${esc(team.name)}</strong>${team.event_name ? `<span class="subtle-label">${esc(team.event_name)}</span>` : ''}</div><p>${esc(team.category || 'Team')} · Camp leader: ${esc(team.camp_leader || 'Not assigned')}</p><div class="record-meta"><span>${Number(team.member_count) || 0} players</span></div></a>`;
}
async function teamsPage() {
  let response;
  try { response = await load('teams'); } catch (error) { return `${pageHeader('Teams', descriptions.teams)}${connectionBanner()}${errorPanel(error.message)}`; }
  const createForm = canManageEvents() ? await createTeamForm() : '';
  return `${pageHeader('Teams', descriptions.teams)}${connectionBanner()}${createForm}<label class="field"><span>Search teams</span><input id="team-search" type="search" placeholder="Search team names"></label><div id="team-list">${itemCards(response.items || [], teamCard, ['No teams yet', 'Teams and camps will appear after they are added to an event.'])}</div>`;
}
async function teamDetailPage(id) {
  let team;
  try { team = await load(`teams/${encodeURIComponent(id)}`); } catch (error) { return `${pageHeader('Team details', descriptions.teams)}${connectionBanner()}${errorPanel(error.message)}`; }
  const members = team.members || [];
  return `${pageHeader(team.team?.name || 'Team details', 'Roster, camp leader and game captain.')}${connectionBanner()}<section class="content-card"><p><strong>Camp leader:</strong> ${esc(team.team?.camp_leader || 'Not assigned')}</p><h2 class="section-title">Players</h2>${itemCards(members, (player) => `<article class="record-card"><strong>${esc(player.full_name)}</strong>${player.is_captain ? '<span class="status-chip status-ongoing">Game captain</span>' : ''}<p>${player.enrolled_verified && player.tryout_passed ? 'Eligibility verified' : 'Eligibility not fully verified'}</p></article>`, ['No players assigned', 'Eligible students can be added by authorized staff.'])}</section>${isStaff() ? await addPlayerForm(id) : ''}`;
}
async function addPlayerForm(teamId) {
  let students = [];
  try { students = (await load('users/students')).items || []; } catch { /* Authorization or directory setup can block this form. */ }
  const eligible = students.filter((student) => student.enrolled_verified && student.tryout_passed);
  return `<details class="content-card form-disclosure"><summary>Manage player eligibility and lineup</summary><details class="inner-disclosure"><summary>Verify student enrollment and tryout</summary><form class="app-form" data-form="verify-eligibility" data-team-id="${esc(teamId)}"><div class="field"><label>Approved student</label><select name="userId" required><option value="" selected disabled>Select a student</option>${students.map((student) => `<option value="${esc(student.id)}">${esc(student.full_name)} — ${student.enrolled_verified ? 'enrollment verified' : 'enrollment not verified'}, ${student.tryout_passed ? 'tryout passed' : 'tryout not passed'}</option>`).join('')}</select></div><label class="check-row"><input type="checkbox" name="enrolledVerified"> Official enrollment verified</label><label class="check-row"><input type="checkbox" name="tryoutPassed"> Tryout passed</label><button class="btn btn-quiet" type="submit" ${students.length ? '' : 'disabled'}>Save verification</button><p class="field-hint">A Teacher may verify only for their assigned camp. The school enrollment/tryout check is manual; no STI records integration was specified.</p></form></details><form class="app-form" data-form="add-player" data-team-id="${esc(teamId)}"><div class="field"><label>Eligible student</label><select name="userId" required>${eligible.map((student) => `<option value="${esc(student.id)}">${esc(student.full_name)}</option>`).join('')}</select></div><label class="check-row"><input type="checkbox" name="isCaptain"> Set as game captain</label><button class="btn" type="submit" ${eligible.length ? '' : 'disabled'}>Add to roster</button>${eligible.length ? '' : '<p class="field-hint">Only approved students with verified enrollment and tryout status can be added.</p>'}</form></details>`;
}
async function leaderboardPage() {
  let standings = [];
  let points = [];
  try { standings = (await load('standings')).items || []; } catch (error) { return `${pageHeader('Leaderboard', descriptions.leaderboard)}${connectionBanner()}${errorPanel(error.message)}`; }
  if (session?.role === 'Admin') { try { points = (await load('admin/medal-points')).items || []; } catch { /* nonfatal */ } }
  const rows = standings.length ? `<div class="table-wrap"><table><thead><tr><th>Rank</th><th>Team</th><th>Event</th><th>Wins</th><th>Points</th></tr></thead><tbody>${standings.map((row) => `<tr><td>${Number(row.rank) || '—'}</td><td>${esc(row.team_name)}</td><td>${esc(row.event_name)}</td><td>${Number(row.wins) || 0}</td><td><strong>${Number(row.points) || 0}</strong></td></tr>`).join('')}</tbody></table></div>` : empty('No standings yet', 'Points and rankings will appear after official medal results are entered.');
  const settings = session?.role === 'Admin' ? `<section class="content-card"><h2 class="section-title">Medal point defaults</h2><form class="inline-form" data-form="medal-points">${['gold', 'silver', 'bronze'].map((medal) => `<label>${medal[0].toUpperCase()}${medal.slice(1)}<input name="${medal}" type="number" min="0" max="100" step="1" value="${Number(points.find((item) => item.medal === medal)?.points ?? ({ gold: 3, silver: 2, bronze: 1 }[medal]))}"></label>`).join('')}<button class="btn" type="submit">Save points</button></form></section>` : '';
  return `${pageHeader('Leaderboard', descriptions.leaderboard)}${connectionBanner()}${settings}${rows}`;
}
async function announcementsPage() {
  let result;
  try { result = await load('announcements'); } catch (error) { return `${pageHeader('Announcements', descriptions.announcements)}${connectionBanner()}${errorPanel(error.message)}`; }
  const form = isOrganizer() ? `<details class="content-card form-disclosure"><summary>Post announcement</summary><form class="app-form" data-form="create-announcement"><div class="field"><label>Title</label><input name="title" required maxlength="180"></div><div class="field"><label>Message</label><textarea name="content" required maxlength="10000"></textarea></div><div class="field"><label>Audience</label><select name="targetAudience"><option value="all">Everyone</option><option value="student">Students</option><option value="teacher">Teachers</option><option value="organizer">Committee/Organizers</option></select></div><button class="btn" type="submit">Publish announcement</button></form></details>` : '';
  const items = result.items || [];
  const list = itemCards(items, (item) => `<article class="record-card"><div class="record-heading"><strong>${esc(item.title)}</strong><span class="subtle-label">${esc(isoDate(item.created_at))}</span></div><p class="announcement-content">${esc(item.content)}</p>${isOrganizer() ? `<button class="btn btn-quiet" data-action="delete-announcement" data-id="${esc(item.id)}" type="button">Archive</button>` : ''}</article>`, ['No announcements yet', 'New schedules and updates from organizers will appear here.']);
  return `${pageHeader('Announcements', descriptions.announcements)}${connectionBanner()}${form}${list}`;
}
async function communityPage() {
  let result;
  try { result = await load('community'); } catch (error) { return `${pageHeader('NexSocial', descriptions.community)}${connectionBanner()}${errorPanel(error.message)}`; }
  let events = [];
  if (session?.role === 'Student') { try { events = (await load('events')).items || []; } catch { /* form remains available without an event link */ } }
  const createForm = session?.role === 'Student' ? `<details class="content-card form-disclosure" open><summary>Share an event moment / attendance proof</summary><form class="app-form" data-form="community-post"><div class="field"><label>Event</label><select name="eventId"><option value="">No event selected</option>${events.map((event) => `<option value="${esc(event.id)}">${esc(event.name)}</option>`).join('')}</select></div><div class="field"><label>Caption or insight</label><textarea name="caption" maxlength="2000" placeholder="Share a tournament moment or attendance note"></textarea></div><div class="field"><label>Photo evidence (JPEG, PNG or WebP; max 8 MiB)</label><input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required></div><button class="btn" type="submit">Upload and submit for review</button><p class="field-hint">Attendance evidence remains pending until reviewed by authorized staff.</p></form></details>` : '';
  const posts = result.items || [];
  const list = itemCards(posts, (post) => `<article class="record-card social-post"><div class="record-heading"><strong>${esc(post.author_name || 'Student')}</strong>${formatStatus(post.attendance_status)}</div>${post.event_name ? `<p class="subtle-label">${esc(post.event_name)}</p>` : ''}<p>${esc(post.caption)}</p><img class="post-image" src="${esc(post.photoUrl)}" alt="NexSocial post submitted by ${esc(post.author_name || 'student')}" loading="lazy"><div class="record-meta"><span>${esc(isoDate(post.created_at))}</span>${post.review_note ? `<span>${esc(post.review_note)}</span>` : ''}</div>${isStaff() && post.attendance_status === 'pending' ? `<div class="action-row"><button class="btn btn-quiet" data-action="review-post" data-id="${esc(post.id)}" data-status="approved" type="button">Validate attendance</button><button class="btn btn-quiet" data-action="review-post" data-id="${esc(post.id)}" data-status="rejected" type="button">Reject evidence</button></div>` : ''}</article>`, ['No community posts yet', 'Student event moments and attendance evidence will appear here.']);
  return `${pageHeader('NexSocial', descriptions.community)}${connectionBanner()}${createForm}${list}`;
}
async function adminUsersPage() {
  if (session?.role !== 'Admin') return `${pageHeader('User approvals', 'Administrative access review.')}${errorPanel('This page is available to administrators only.')}`;
  let result;
  try { result = await load('admin/users'); } catch (error) { return `${pageHeader('User approvals', 'Administrative access review.')}${connectionBanner()}${errorPanel(error.message)}`; }
  const items = result.items || [];
  const list = itemCards(items, (user) => `<article class="record-card"><div class="record-heading"><strong>${esc(user.full_name)}</strong>${formatStatus(user.account_status)}</div><p>${esc(user.email)} · ${esc(user.role)}</p><div class="record-meta"><span>Requested ${esc(isoDate(user.created_at))}</span></div><div class="action-row"><button class="btn" data-action="approve-user" data-id="${esc(user.id)}" type="button">Approve</button><button class="btn btn-quiet" data-action="reject-user" data-id="${esc(user.id)}" type="button">Reject</button></div></article>`, ['No pending requests', 'New registrations awaiting approval will appear here.']);
  return `${pageHeader('User approvals', 'Review registration requests before enabling access.')}${connectionBanner()}${list}`;
}
function profilePage() {
  const user = session || {};
  return `${pageHeader('Profile', 'Account information from Intranexus.')}${connectionBanner()}<section class="content-card"><h2 class="section-title">Account</h2><p><strong>User ID:</strong> <code>${esc(user.id || 'Not available')}</code></p><p><strong>Name:</strong> ${esc(user.fullName || 'Not provided')}</p><p><strong>Email:</strong> ${esc(user.email || 'Not provided')}</p><p><strong>Role:</strong> ${esc(user.role || 'Not provided')}</p></section>`;
}
async function collectionPage(key) {
  if (key === 'events') return eventsPage();
  if (key === 'matches') return matchesPage();
  if (key === 'teams') return teamsPage();
  if (key === 'leaderboard') return leaderboardPage();
  if (key === 'announcements') return announcementsPage();
  return communityPage();
}
function syncRealtime() {
  if (!session || apiState !== 'ready') {
    realtimeSource?.close();
    realtimeSource = null;
    return;
  }
  if (realtimeSource) return;
  realtimeSource = new EventSource(`${API}/realtime`);
  realtimeSource.addEventListener('update', () => {
    if (document.activeElement?.closest('form')) { pendingLiveRefresh = true; return; }
    void render();
  });
}
async function render() {
  if (!app) return;
  syncRealtime();
  app.setAttribute('aria-busy', 'true');
  let route = currentRoute();
  if (route.key === 'home') { history.replaceState({}, '', '/signIn'); route = currentRoute('/signIn'); }
  if (['signIn', 'register'].includes(route.key)) {
    if (session && apiState === 'ready') { history.replaceState({}, '', '/dashboard'); return render(); }
    app.innerHTML = authPage(route.key === 'register');
    app.setAttribute('aria-busy', 'false');
    return;
  }
  if (!session) {
    app.innerHTML = authPage(false);
    app.setAttribute('aria-busy', 'false');
    return;
  }
  let content;
  if (route.key === 'dashboard') content = await dashboardPage();
  else if (collections[route.key]) content = await collectionPage(route.key);
  else if (route.key === 'eventDetail') content = await eventDetailPage(route.params[0]);
  else if (route.key === 'teamDetail') content = await teamDetailPage(route.params[0]);
  else if (route.key === 'adminUsers') content = await adminUsersPage();
  else if (route.key === 'profile') content = profilePage();
  else content = `<div class="route-not-found"><h1>Page not found</h1><a class="text-link" href="/dashboard" data-link>Return to dashboard</a></div>`;
  app.innerHTML = shell(content, route);
  app.setAttribute('aria-busy', 'false');
}
function formValues(form) { return Object.fromEntries(new FormData(form)); }
function feedback(target, message, type = 'success') {
  const element = typeof target === 'string' ? document.querySelector(target) : target;
  if (element) element.innerHTML = `<div class="form-feedback feedback-${type}" role="status">${esc(message)}</div>`;
}
async function submitAuth(form) {
  const register = form.id === 'register-form';
  const button = form.querySelector('button[type="submit"]');
  if (!form.reportValidity()) return;
  const values = formValues(form);
  button.disabled = true;
  button.textContent = register ? 'Submitting…' : 'Signing in…';
  try {
    const data = await mutate(`${API}/auth/${register ? 'register' : 'login'}`, 'POST', register
      ? { fullName: values.fullName, email: values.email, password: values.password, role: values.role }
      : { email: values.email, password: values.password });
    csrfToken = data.csrfToken || null;
    if (register) {
      form.reset();
      feedback('#form-feedback', data.message || 'Registration request received. Access is subject to administrator review.');
    } else {
      await refreshSession();
      if (session) go('/dashboard');
      else feedback('#form-feedback', apiNote || 'Sign-in did not return an active session.', 'error');
    }
  } catch (error) {
    if (error.status === 503) { apiState = 'offline'; apiNote = 'PostgreSQL connection setup is on hold. No login or registration data was saved.'; }
    feedback('#form-feedback', error.message || 'The request could not be completed. Please try again.', 'error');
  } finally {
    button.disabled = false;
    button.innerHTML = register ? 'Request access <span aria-hidden="true">→</span>' : 'Sign in <span aria-hidden="true">→</span>';
  }
}
async function logout() {
  try { await mutate(`${API}/auth/logout`, 'POST'); } catch { /* Clear local view even if the session expired. */ }
  session = null; csrfToken = null; go('/signIn');
}
async function submitForm(form) {
  const type = form.dataset.form;
  const data = formValues(form);
  const button = form.querySelector('button[type="submit"]');
  if (!form.reportValidity()) return;
  if (button) button.disabled = true;
  try {
    if (type === 'create-event') {
      const eventFormat = data.category === 'sports' ? 'round_robin' : 'single_elimination';
      if (data.startsAt) data.startsAt = new Date(data.startsAt).toISOString();
      await mutate(`${API}/events`, 'POST', { ...data, eventFormat });
      feedback('#action-feedback', 'Event created.');
      await render();
    } else if (type === 'create-team') {
      await mutate(`${API}/teams`, 'POST', { ...data, campLeaderId: data.campLeaderId || null });
      await render();
    } else if (type === 'add-player') {
      await mutate(`${API}/teams/${encodeURIComponent(form.dataset.teamId)}/members`, 'POST', { userId: data.userId, isCaptain: form.querySelector('[name="isCaptain"]').checked });
      await render();
    } else if (type === 'verify-eligibility') {
      await mutate(`${API}/users/${encodeURIComponent(data.userId)}/eligibility`, 'PATCH', { teamId: form.dataset.teamId, enrolledVerified: form.querySelector('[name="enrolledVerified"]').checked, tryoutPassed: form.querySelector('[name="tryoutPassed"]').checked });
      await render();
    } else if (type === 'score-match') {
      const updated = await mutate(`${API}/matches/${encodeURIComponent(form.dataset.id)}/score`, 'PATCH', { homeScore: Number(data.homeScore), awayScore: Number(data.awayScore) });
      if (form.dataset.autoSaving === 'true') {
        const card = form.closest('.record-card');
        const display = card?.querySelector('[data-score-display]');
        if (display) display.textContent = `${Number(updated.home_score)} — ${Number(updated.away_score)}`;
        const status = card?.querySelector('.status-chip');
        if (status) { status.textContent = 'ongoing'; status.className = 'status-chip status-ongoing'; }
        feedback(card?.querySelector('[id^="feedback-"]') || form, `Score auto-saved at ${new Date().toLocaleTimeString()}.`);
      } else await render();
    } else if (type === 'create-announcement') {
      await mutate(`${API}/announcements`, 'POST', { title: data.title, content: data.content, targetAudience: [data.targetAudience || 'all'] });
      await render();
    } else if (type === 'medal-points') {
      await mutate(`${API}/admin/medal-points`, 'PATCH', { points: { gold: Number(data.gold), silver: Number(data.silver), bronze: Number(data.bronze) } });
      feedback(form, 'Medal point values saved.');
      await render();
    } else if (type === 'award-team') {
      await mutate(`${API}/events/${encodeURIComponent(form.dataset.eventId)}/awards`, 'POST', { teamId: data.teamId, medal: data.medal });
      feedback(form, 'Medal result recorded.');
      await render();
    } else if (type === 'community-post') {
      const file = form.querySelector('[name="photo"]').files?.[0];
      if (!file) throw new Error('Choose a photo to continue.');
      const intent = await mutate(`${API}/uploads/presign`, 'POST', { contentType: file.type, size: file.size });
      const uploaded = await fetch(intent.uploadUrl, { method: 'PUT', headers: { 'Content-Type': intent.contentType }, body: file, credentials: 'omit' });
      if (!uploaded.ok) throw new Error('The photo upload could not be completed. No post was created.');
      await mutate(`${API}/community/posts`, 'POST', { eventId: data.eventId || null, caption: data.caption || '', photoKey: intent.photoKey });
      await render();
    }
  } catch (error) {
    const feedbackTarget = form.querySelector('[data-form-feedback]') || form;
    feedback(feedbackTarget, error.message || 'The change could not be saved.', 'error');
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}
function queueScoreAutosave(form) {
  const existing = scoreTimers.get(form);
  if (existing) clearTimeout(existing);
  const inputs = ['homeScore', 'awayScore'].map((name) => form.elements.namedItem(name));
  const valid = inputs.every((input) => input && input.value !== '' && Number.isSafeInteger(Number(input.value)) && Number(input.value) >= 0);
  const finishButton = form.closest('.record-card')?.querySelector('[data-action="finish-match"]');
  if (!valid) { if (finishButton && form.dataset.scoreSaving !== 'true') finishButton.disabled = false; return; }
  if (form.dataset.scoreSaving === 'true') { form.dataset.queuedAutosave = 'true'; return; }
  if (finishButton) finishButton.disabled = true;
  scoreTimers.set(form, setTimeout(() => void saveScoreAutomatically(form), 650));
}
async function saveScoreAutomatically(form) {
  scoreTimers.delete(form);
  if (!form.isConnected || form.dataset.scoreSaving === 'true') return;
  form.dataset.scoreSaving = 'true';
  form.dataset.autoSaving = 'true';
  try { await submitForm(form); }
  finally {
    delete form.dataset.autoSaving;
    delete form.dataset.scoreSaving;
    const finishButton = form.closest('.record-card')?.querySelector('[data-action="finish-match"]');
    if (form.dataset.queuedAutosave === 'true') { delete form.dataset.queuedAutosave; queueScoreAutosave(form); }
    else if (finishButton) finishButton.disabled = false;
  }
}
async function actionClick(button) {
  const { action, id } = button.dataset;
  if (action === 'logout') return logout();
  if (action === 'toggle-more') {
    const menu = document.querySelector('#mobile-more');
    if (!menu) return;
    menu.hidden = !menu.hidden;
    button.setAttribute('aria-expanded', String(!menu.hidden));
    return;
  }
  if (action === 'generate-bracket') {
    const count = Number(button.dataset.teamCount);
    const format = button.dataset.format?.replaceAll('_', ' ');
    if (count < 2) return feedback('#action-feedback', 'Add at least two teams before generating fixtures.', 'error');
    const confirmed = window.confirm(`Review summary:\nEvent: ${button.dataset.name}\nTeams: ${count}\nFormat: ${format}\n\nGenerate the tournament bracket now? This creates the initial matches.`);
    if (!confirmed) return;
    try { await mutate(`${API}/events/${encodeURIComponent(id)}/generate`, 'POST', { summaryConfirmed: true }); await render(); }
    catch (error) { feedback('#action-feedback', error.message, 'error'); }
  } else if (action === 'finish-match') {
    if (!window.confirm('Mark this match as finished? You can lock the official result after confirming the score.')) return;
    try { await mutate(`${API}/matches/${encodeURIComponent(id)}/status`, 'PATCH', { status: 'finished' }); await render(); }
    catch (error) { feedback(`#feedback-${CSS.escape(id)}`, error.message, 'error'); }
  } else if (action === 'lock-match') {
    if (!window.confirm('Finalize and lock this official result? A locked result cannot be edited through normal scoring.')) return;
    try { await mutate(`${API}/matches/${encodeURIComponent(id)}/lock`, 'POST'); await render(); }
    catch (error) { feedback(`#feedback-${CSS.escape(id)}`, error.message, 'error'); }
  } else if (action === 'schedule-match') {
    const current = button.closest('.record-card');
    const value = window.prompt('Enter date/time in ISO format (example: 2026-11-04T10:00:00+08:00). Leave blank to clear:', '');
    if (value === null) return;
    const venue = window.prompt('Enter venue or region:', '');
    if (venue === null) return;
    try { await mutate(`${API}/matches/${encodeURIComponent(id)}/schedule`, 'PATCH', { scheduledAt: value || null, venue }); await render(); }
    catch (error) { feedback(current?.querySelector('[id^="feedback-"]') || current, error.message, 'error'); }
  } else if (action === 'approve-user' || action === 'reject-user') {
    const status = action === 'approve-user' ? 'approved' : 'rejected';
    if (!window.confirm(`${status === 'approved' ? 'Approve' : 'Reject'} this registration request?`)) return;
    try { await mutate(`${API}/admin/users/${encodeURIComponent(id)}/decision`, 'PATCH', { status }); await render(); }
    catch (error) { feedback(button.closest('.record-card'), error.message, 'error'); }
  } else if (action === 'review-post') {
    const status = button.dataset.status;
    try { await mutate(`${API}/community/posts/${encodeURIComponent(id)}/review`, 'PATCH', { status }); await render(); }
    catch (error) { feedback(button.closest('.record-card'), error.message, 'error'); }
  } else if (action === 'delete-announcement') {
    if (!window.confirm('Archive this announcement? It will no longer appear to readers.')) return;
    try { await mutate(`${API}/announcements/${encodeURIComponent(id)}`, 'DELETE'); await render(); }
    catch (error) { feedback(button.closest('.record-card'), error.message, 'error'); }
  }
}

document.addEventListener('click', (event) => {
  const stepper = event.target.closest('[data-score-step]');
  if (stepper) {
    const form = stepper.closest('form[data-form="score-match"]');
    const input = form?.elements.namedItem(stepper.dataset.scoreTarget);
    if (input) { input.value = String(Math.max(0, (Number(input.value) || 0) + Number(stepper.dataset.scoreStep))); input.dispatchEvent(new Event('input', { bubbles: true })); }
    return;
  }
  const link = event.target.closest('a[data-link]');
  if (link?.getAttribute('href')?.startsWith('#')) {
    event.preventDefault();
    const target = document.querySelector(link.getAttribute('href'));
    if (target) { if ('open' in target) target.open = true; target.scrollIntoView({ behavior: 'auto', block: 'start' }); }
    return;
  }
  if (link) { event.preventDefault(); go(link.getAttribute('href')); return; }
  const button = event.target.closest('[data-action]');
  if (button) { event.preventDefault(); void actionClick(button); }
});
document.addEventListener('submit', (event) => {
  const form = event.target;
  if (form.matches('#login-form, #register-form')) { event.preventDefault(); void submitAuth(form); return; }
  if (form.matches('[data-form]')) {
    event.preventDefault();
    if (form.matches('[data-form="score-match"]')) { const timer = scoreTimers.get(form); if (timer) clearTimeout(timer); scoreTimers.delete(form); }
    void submitForm(form).finally(() => { const finishButton = form.closest('.record-card')?.querySelector('[data-action="finish-match"]'); if (finishButton && form.isConnected) finishButton.disabled = false; });
  }
});
document.addEventListener('input', (event) => {
  const scoreForm = event.target.closest?.('form[data-form="score-match"]');
  if (scoreForm && ['homeScore', 'awayScore'].includes(event.target.name)) queueScoreAutosave(scoreForm);
  if (event.target.id === 'match-search' || event.target.id === 'match-status') {
    const query = (document.querySelector('#match-search')?.value || '').trim().toLowerCase();
    const status = document.querySelector('#match-status')?.value || '';
    document.querySelectorAll('#match-list .record-card').forEach((card) => {
      const matchesQuery = !query || card.textContent.toLowerCase().includes(query);
      const matchesStatus = !status || card.textContent.toLowerCase().includes(status);
      card.hidden = !(matchesQuery && matchesStatus);
    });
  }
  if (event.target.id === 'team-search') {
    const query = event.target.value.trim().toLowerCase();
    document.querySelectorAll('#team-list .record-card').forEach((card) => { card.hidden = !card.textContent.toLowerCase().includes(query); });
  }
});
document.addEventListener('focusout', () => queueMicrotask(() => {
  if (pendingLiveRefresh && !document.activeElement?.closest('form')) { pendingLiveRefresh = false; void render(); }
}));
window.addEventListener('popstate', () => void render());
await refreshSession();
await render();
