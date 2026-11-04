# Intranexus

Responsive STI College Malolos intramural web app. The frontend is vanilla HTML/CSS/JavaScript; the backend is Node.js/Express; persistent application data uses an external PostgreSQL database. The project's already-provisioned Manus MySQL capability is intentionally unused.

## Run locally

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The server listens on `PORT` (default `3000`). Without `EXTERNAL_POSTGRES_URL`, the responsive sign-in UI remains available and clearly reports that PostgreSQL setup is pending; authentication and data operations do not pretend to succeed.

## Configure PostgreSQL when ready

Add `EXTERNAL_POSTGRES_URL` through the project's protected secret-input flow. Do not commit it, place it in browser code, or include it in logs or chat. Then run the committed, additive migrations once:

```sh
pnpm db:migrate
```

Development and any later published deployment use this same external database. Review the provider's TLS requirements and database access scope before connecting it.

## Create the first administrator

Registration only accepts Student, Teacher, or Committee/Organizer and new accounts remain pending until Admin approval. Create the initial Admin with the protected bootstrap script after the database is connected. Supply `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL`, and `BOOTSTRAP_ADMIN_PASSWORD` as runtime environment values; do not pass the password on a command line or commit it. Run:

```sh
pnpm db:bootstrap-admin
```

Optional `ALLOWED_STI_EMAIL_DOMAINS` can restrict registration once the official STI domain is confirmed; it is intentionally not guessed. Enrollment and tryout eligibility are verified manually by authorized camp leaders because no STI student-record integration was specified.

## Runtime notes

- Cloud Preview uses HTTPS even if the server sees an internal HTTP request. Keep the default secure `SameSite=None` session cookies; set `COOKIE_SECURE=false` only for intentional plain-HTTP local development.
- NexSocial image bytes use durable platform object storage through server-side presigned URLs. PostgreSQL stores ownership, post, review, and upload-intent metadata.
- Sports fixtures use round-robin; esports fixtures use the approved single-elimination default. Medal points default to gold/silver/bronze = 3/2/1 and are configurable by Admin.
- `GET /api/health` reports readiness only after the PostgreSQL connection and migrations are available.
