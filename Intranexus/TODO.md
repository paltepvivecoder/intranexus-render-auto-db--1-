# Intranexus — TODO

## Responsive web interface and existing sign-in UI

- [ ] Palitan ang FlutterFlow front end ng web UI na gumagamit ng HTML, CSS at JavaScript, hindi FlutterFlow; panatilihin ang nakitang dark charcoal, violet/purple accent, rounded sign-in panel at “Welcome back!” direction; gawing responsive at madaling gamitin sa desktop at mobile.
- [ ] Ipatupad ang desktop navigation/content layout at compact mobile navigation; gawing cards ang malalapad na match/team tables sa maliit na screen; magbigay ng accessible labels, focus states, loading/error/empty states.

## User accounts, sign-in and role approval

- [ ] Payagan ang Admin, Teacher, Student at Committee/Organizer registration gamit ang user ID, full name, STI email, password at role; gumamit ng secure email/password login at tanggihan ang maling credentials.
- [ ] Ilagay sa admin review/approval ang bagong registrant bago bigyan ng system access; para sa Committee/Organizer, tahasang kailangan ang admin approval bago magamit ang organizer functions; gamitin lamang ang kinumpirmang STI email domain kapag ibinigay at huwag mag-imbento ng domain.
- [ ] Ihiwalay at ipatupad sa server ang role permissions; Admin ang may system control at organizer-level access; limitado sa authorized users ang administrative functions.

## Events, schedule, bracket generation and match management

- [ ] Pahintulutan ang organizer/admin na gumawa at mag-configure ng sports at esports events, kasama ang event name, participating teams, format, date/time, venue o region at iba pang kinakailangang detalye.
- [ ] Bago gumawa ng fixtures, magpakita ng pre-generation summary ng tournament configuration; pagkatapos kumpirmahin, awtomatikong gumawa ng round-robin bracket/matchups para sa sports at single-elimination structured bracket para sa esports.
- [ ] Pahintulutan ang paglikha/pagtatalaga ng camps/teams sa matches at pamahalaan ang match status na upcoming, ongoing at finished; itala ang match ID, teams, date/time, venue, scores, status at timestamp.
- [ ] Magbigay ng schedule management; huwag ipangako na awtomatikong malulutas ang lahat ng biglaang schedule/venue conflicts o changes.

## Teams, camps and player lineups

- [ ] Pahintulutan ang Admin/authorized organizers na gumawa, mag-edit at magtanggal ng teams/camps, magtakda ng event/category, at magtalaga ng teacher bilang camp leader.
- [ ] Pahintulutan ang Teacher na magtalaga ng players mula sa kanilang camp/team at magtakda ng game captain; tiyaking ang player ay opisyal na enrolled at dumaan sa tryouts bago maisama sa sports/esports lineups at games.
- [ ] Ipakita sa Students at Teachers ang team name, roster/members, leader, captains at players.

## Scoring, official results and standings

- [ ] Payagan lamang ang authorized officials/organizers na mag-input at mag-update ng score; suportahan ang manual increment/decrement, validation, autosave at timestamp.
- [ ] I-update ang digital scoreboard at match results nang real-time sa lahat ng nakakonektang user nang hindi nire-refresh ang pahina; kalkulahin ang wins at standings mula sa resulta.
- [ ] Pahintulutan ang awtorisadong Admin/Organizer na i-finalize at i-lock ang completed match; hindi mababago ang kumpirmadong official result nang walang tamang authorization.
- [ ] Awtomatikong mag-generate at magpakita ng team/camp rankings batay sa total points at approved configurable gold/silver/bronze point defaults na 3/2/1; panatilihing configurable ang points.
- [ ] Payagan ang paghahanap at pag-filter ng matches, teams at scores.

## Announcements

- [ ] Pahintulutan ang Admin/Committee/Organizer na gumawa, mag-edit at magtanggal ng announcements tungkol sa schedules, updates at mahahalagang pangyayari; itala ang title, content, date at target audience.
- [ ] Payagan ang Students at Teachers na makita at basahin ang announcements ng Admin/Committee/Organizer.

## NexSocial community and attendance evidence

- [ ] Payagan ang Students na mag-post ng insights/caption at larawan mula sa intramural event sa NexSocial bilang participation/attendance proof.
- [ ] Payagan ang Teacher/authorized staff na makita at i-validate ang photo proof bilang batayan ng attendance; payagan ang Admin at Committee/Organizer na tumingin ng community posts.
- [ ] I-validate ang larawan sa server (uri/laki at authorization); itabi ang image bytes sa durable object storage at metadata/ownership/status sa PostgreSQL; huwag i-commit ang larawan o credentials sa Git.

## PostgreSQL, audit trail, privacy and operational behavior

- [ ] Ikonekta ang application sa external PostgreSQL gamit ang protected `EXTERNAL_POSTGRES_URL`; panatilihing unused ang managed MySQL na na-enable na sa project; huwag ilagay ang DSN/password sa source code, frontend bundle, logs o chat.
- [ ] Gumawa ng deterministic, additive PostgreSQL schema/migrations para sa users/roles/approvals, events, teams/players, matches/scores, points, announcements, community posts/attendance at audit log.
- [ ] Itala sa audit log ang bawat data modification kasama ang user ID, action, petsa at oras; gamitin ang parameterized SQL at transactions para mapanatili ang integrity ng scores/results.
- [ ] Protektahan user/game data, enforce role-based access control at privacy/institutional policy; ang accuracy ng scores, standings at reports ay nakasalalay sa awtorisadong user input.
- [ ] Limitahan ang system sa STI College Malolos intramurals, team-based sports/esports, at internet-connected use; real-time synchronization ay nangangailangan ng stable internet connection.
