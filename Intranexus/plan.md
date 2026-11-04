# Intranexus Web App — Approved Implementation Plan

## Layunin at saklaw

Ililipat ang Intranexus mula FlutterFlow tungo sa responsive web application para sa STI College Malolos. Gagamit ang frontend ng **vanilla HTML, CSS, at JavaScript** (walang FlutterFlow at walang frontend framework). Gagamit ng JavaScript sa Node.js/Express para sa backend API. Ang application data ay nasa **external PostgreSQL**.

Ang scope ay batay sa capstone manuscript na ibinigay ng user at sa nakikitang bahagi ng kasalukuyang FlutterFlow sign-in screen. Ang UI reference ay nagpapakita ng dark charcoal na background, violet/purple accent at rounded sign-in panel na may “Welcome back!”; gagamitin ito bilang direksyon ng sign-in at ng magkakatugmang desktop/mobile application screens. Hindi kumpleto ang na-render na FlutterFlow page kaya hindi ipagpapalagay ang mga detalyeng hindi nakita.

## Product modules

1. **Accounts at role-based access** — registration at login gamit ang STI email at password; apat na role: Admin, Committee/Organizer, Teacher, at Student. Ilalagay sa admin approval queue ang mga bagong account bago bigyan ng access, batay sa manuscript flow na nagsasabing sinusuri ng admin ang mga registrant. Protektahan ang password gamit ang scrypt hashing; gumamit ng server-side session, secure HttpOnly cookie, CSRF protection, at server-side role checks. Itatala rin ang failed/unauthorized access nang hindi nagbubunyag ng sensitibong detalye.
2. **Admin console** — aprubahan/tanggihan ang registration; pamahalaan ang events, teams/camps, players, teacher/camp leaders at game captains; mag-post/mag-edit/magtanggal ng announcements; tingnan ang NexSocial; at i-lock ang pinal na match results.
3. **Committee/Organizer workspace** — mag-configure ng sports at esports events, participating teams, event format, schedule at venue; suriin ang pre-generation summary; gumawa at mag-manage ng schedule/brackets; mag-update ng match status na upcoming/ongoing/finished at scores; mag-manage ng announcements; at subaybayan ang score integrity.
4. **Teacher workspace** — tumingin ng announcements, schedules, scores, teams, players at leaderboard; magtalaga ng eligible students sa camp/game at magtakda ng captains; suriin at mag-validate ng attendance photo proof na ipinasa sa NexSocial.
5. **Student workspace** — tumingin ng announcements, match schedule/status/results, team members/leaders/captains/players, brackets at standings; gumawa ng NexSocial post na may larawan bilang attendance evidence.
6. **Tournament, standings at live updates** — sports events: automated round-robin fixtures; esports: **approved single-elimination bracket**. Authorized score changes ay validated, may timestamp at audit entry, at awtomatikong nag-a-update ng wins, standings at scoreboard. Ang live display ay gagamit ng PostgreSQL `LISTEN/NOTIFY` at Server-Sent Events (SSE), na may reconnect/reload fallback. May search/filter para sa matches, teams at scores. Ang leaderboard points ay **approved configurable defaults na 3/2/1 para sa gold/silver/bronze**.
7. **Data integrity at privacy** — audit trail para sa pagbabago ng records (user, action, petsa/oras); access control sa admin functions; HTTPS-only deployment behavior; image ownership/metadata sa PostgreSQL at image bytes sa durable object storage, hindi sa Git o database. Ang system ay para lamang sa STI College Malolos at nangangailangan ng matatag na internet. Saklaw nito ang team-based events; hindi nito ipinapangakong kusang malulutas ang biglaang venue/match conflicts, at nakadepende ang accuracy sa tamang input ng awtorisadong user.

## Mahalagang configuration constraint: external PostgreSQL

Sa unang project initialization, na-enable ang Manus managed MySQL database. Ayon sa project configuration contract, **one-way ang database enablement at hindi maaaring i-disable** sa kasalukuyang project. Tinanggap ng user na manatiling provisioned ngunit hindi gagamitin ng application ang managed MySQL. Upang matupad ang piniling external PostgreSQL nang hindi sumasalungat sa reserved `DATABASE_URL`, babasahin ng application ang PostgreSQL DSN mula sa hiwalay na protected secret na `EXTERNAL_POSTGRES_URL`; ise-save lamang ito sa secure input card kapag naibigay na ng user ang provider connection string.

Ang uploaded community photos ay itatabi sa durable Manus object storage sa pamamagitan ng server-side presigned upload workflow; ang stable asset key/URL at attendance metadata lamang ang ilalagay sa PostgreSQL. Ang server-side platform credentials ay hindi ilalagay sa browser code.

## Implementation approach

- **Frontend:** semantic HTML, responsive CSS at ES modules/vanilla JavaScript; mobile-first layouts na umaangkop sa phone, tablet at desktop; accessible labels, keyboard focus at malinaw na loading/error/empty states.
- **Backend:** Node.js 22 + Express; JSON API; `pg` connection pool para sa `EXTERNAL_POSTGRES_URL`; SQL migrations na deterministic at additive; parameterized queries at database transactions para sa score updates, locking at bracket generation.
- **Authentication:** self-managed email/password dahil tahasang nakasaad sa manuscript ang email/password registration at login. Hindi gagamit ng Manus OAuth para palitan ang requirement. Hindi pa tinukoy sa manuscript ang eksaktong STI email domain; hindi ito magha-hardcode hangga’t hindi kinukumpirma. Admin approval ang eligibility gate.
- **Storage:** secure server authorization, MIME/size validation, randomized object keys, stable `/manus-storage/...` URLs, at soft-delete ng post records kung kinakailangan. Hindi ipapangakong pisikal na buburahin ang uploaded bytes sa runtime API.
- **Tournament rules:** awtomatikong round-robin para sa sports; single-elimination para sa esports; configurable gold/silver/bronze points na default 3/2/1. Walang hardcoded tie-breaker hangga't hindi napagkakasunduan.

## Pangunahing project structure

```text
/home/ubuntu/intranexus/
  plan.md
  TODO.md                 # outcome criteria; gagawin bago config/code
  package.json
  pnpm-workspace.yaml     # pinned package manager at reviewed script policy
  server/
    app.js                # Express app at route registration
    db/pool.js            # PostgreSQL pool mula sa EXTERNAL_POSTGRES_URL
    db/migrations/        # schema at additive migrations
    middleware/           # session, CSRF, role authorization, validation
    routes/               # auth, admin, events, teams, matches, standings,
                           # announcements, community, attendance
    services/             # tournament generation, scoring, standings,
                           # storage presigning, SSE notifications, audit log
  public/
    index.html
    css/styles.css
    js/                    # vanilla JS modules para sa sign-in at app screens
    manus-routes.json      # lahat ng public-facing page routes
  Dockerfile              # production container kung hihilingin ang publish
```

## Design direction

- **Design Movement:** dark-mode-first campus tournament control surface, na nagmumula sa kasalukuyang FlutterFlow sign-in reference.
- **Core Principles:** malinaw na hierarchy; mabilis makita ang susunod na match at score; role-aware controls; pare-parehong desktop at mobile navigation.
- **Color Philosophy:** charcoal/slate base para sa tuloy-tuloy na paggamit at violet bilang natatanging action accent; semantic status colors para sa upcoming, live at finished na laban; sapat na text contrast.
- **Layout Paradigm:** desktop na may persistent side navigation at content canvas; mobile na may compact top bar at bottom/compact navigation, habang ang tables ay nagiging stacked match/team cards.
- **Signature Elements:** violet active-navigation marker; match-status chips; score-first cards na nagpapakita ng team pairing, oras at venue.
- **Interaction Philosophy:** malinaw na confirmation bago i-lock ang resulta o mag-save ng bracket; agarang feedback sa score/status; madaling mahanap ang search/filter.
- **Animation:** maikli at banayad na transitions para sa tabs, notices at live score changes; walang motion na humahadlang sa paggamit.
- **Typography System:** system sans-serif stack para mabilis at legible sa iba’t ibang device; malinaw na numeric hierarchy para sa score at leaderboard.
- **Brand Essence:** maaasahang campus tournament hub para sa STI Malolos; organisado, patas, napapanahon.
- **Brand Voice:** maikli at direkta. Halimbawa: “Susunod na laban” at “Nai-save ang opisyal na score.”
- **Wordmark & Logo:** text-first INTRANEXUS wordmark na may compact linked-bracket “N” mark; hindi gagamit ng hindi awtorisadong school seal.
- **Signature Brand Color:** violet/purple, alinsunod sa nakitang accent sa kasalukuyang UI.

## Natitirang configuration detail

Kailangan pa ang eksaktong STI email domain(s) kung nais ng automatic email-domain restriction. Hangga’t wala ito, hindi mag-iimbento o magha-hardcode ng domain; admin approval ang magpapatunay ng eligibility.

Inaprubahan ng user ang implementation plan, ang paggamit ng external PostgreSQL sa `EXTERNAL_POSTGRES_URL` habang nananatiling unused ang managed MySQL, ang single-elimination esports bracket, at ang configurable 3/2/1 gold/silver/bronze defaults. Nilikha ang TODO bago ang configuration at application implementation.