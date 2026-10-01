# Deploying starkupps-admin to Google Cloud Run

Live service:

```
https://starkupps-admin-261175458017.asia-northeast2.run.app
```

| | |
| --- | --- |
| GCP project | `starkupps-backend` |
| Region | `asia-northeast2` (Seoul) |
| Supabase project | `starkupps-dev` / `njqrcxtjzghlyrmgsrmq` |

The region matches the Supabase project on purpose. Every query and realtime
subscription crosses the region boundary, so a mismatch adds ~200 ms per
database round trip.

---

## Deploying by hand

GitHub is **not** connected to this service, so a push does nothing. Until that
is set up, deploy manually after every merge.

```sh
cd starkupps-admin
git pull

# Verify before shipping.
npm run verify        # lint -> typecheck -> test -> build

gcloud run deploy starkupps-admin \
  --region asia-northeast2 \
  --source . \
  --allow-unauthenticated
```

`--source .` uploads this directory and builds the `Dockerfile` beside it. The
build takes 2-4 minutes.

Add `--min-instances 1` on the first deploy of a new instance so realtime SSE
streams are not cut off when the service scales to zero. It is already set on
the live service.

### Confirm it worked

```sh
curl -s https://starkupps-admin-261175458017.asia-northeast2.run.app/api/health
# {"status":"ok","timestamp":"..."}

gcloud run services describe starkupps-admin --region asia-northeast2 \
  --format='value(status.latestReadyRevision)'
```

Check `status.latestReadyRevision` is non-empty. A deploy that reports success
but leaves this blank means the container never started listening.

### Watch the logs

```sh
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="starkupps-admin"' \
  --project starkupps-backend --limit 20
```

Startup crashes are logged here rather than on the deploy output. The deploy
only says the container failed to listen on `$PORT`.

---

## Environment variables

Set once on the service, not per deploy. Env vars are **replaced**, not merged,
on update, so always send the full set.

```sh
gcloud run services describe starkupps-admin --region asia-northeast2 \
  --format='value(spec.template.spec.containers[0].env)'
```

To change them, write an ENV file and use `--env-vars-file`:

```sh
cat > /tmp/admin.env <<EOF
NODE_ENV=production
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
DATABASE_URL=...
DIRECT_URL=...
SESSION_SECRET=...
APP_URL=https://starkupps-admin-261175458017.asia-northeast2.run.app
CORS_ORIGINS=https://starkupps.com,https://www.starkupps.com,https://starkupps.in,https://www.starkupps.in
OWNER_EMAIL=starkupps@gmail.com
OWNER_OPEN_ID=email:starkupps@gmail.com
EOF

gcloud run services update starkupps-admin \
  --region asia-northeast2 \
  --env-vars-file=/tmp/admin.env

shred -u /tmp/admin.env
```

### `--set-env-vars` will fail on URLs

`gcloud run deploy --set-env-vars "CORS_ORIGINS=https://a.com"` errors with
`Bad syntax for dict arg`. gcloud parses the flag as a dictionary and reads the
`//` in `https://` as a separator. Use `--env-vars-file` for any value
containing a URL.

### Values that must be right

- `APP_URL` — must be `https://`. The gateway throws on startup otherwise, since
  session cookies carry the `Secure` flag.
- `SESSION_SECRET` — 48+ random bytes. `openssl rand -base64 48`. The server
  also rejects known placeholder values.
- `DATABASE_URL` / `DIRECT_URL` — the password is URL-encoded. A password
  containing `#`, `$`, or `@` must be percent-encoded or the connection string
  parses wrong.
- `CORS_ORIGINS` — comma-separated exact origins, scheme included. Both apex
  and `www` are separate origins to a browser. The gateway omits
  `Access-Control-Allow-Origin` entirely for anything not listed.
- `PORT` — **do not set it.** Cloud Run injects it and rejects the deploy as a
  reserved name.

---

## Connecting GitHub for auto-deploy

Not currently active. Check with:

```sh
gcloud run services describe starkupps-admin --region asia-northeast2 \
  --format='value(metadata.annotations)'
```

`build-enable-automatic-updates=false` means pushes do not deploy.

To connect, in the console: **Cloud Run → starkupps-admin → Source → Connect to
repo**

| Field | Value |
| --- | --- |
| Branch | `^main$` |
| Build type | Dockerfile |
| Source location | `starkupps-admin/Dockerfile` |

Source location is the field that breaks builds. It sets both the Dockerfile path
and the build context. Left at `/Dockerfile`, Cloud Build looks in the repo root,
finds nothing, and fails. The repo has two apps and no root `package.json`, so
the root is never the right context.

The connection is created per region. An existing Developer Connect connection in
another region is not reused, so expect to authorize the GitHub App again for
`asia-northeast2`.

Once connected, every push to `main` rebuilds and redeploys. There is no approval
gate, and with `min-instances 1` the previous revision keeps serving until the
new one is ready, so a failed build leaves the last good version live.

---

## Troubleshooting

**`container failed to start and listen on the port defined by PORT`**

The image built, the process died on boot. Almost always a missing or invalid
env var, since `server/config/env.ts` throws during module load before `listen()`.
Read the logs, they carry the actual message.

**`ZIP does not support timestamps before 1980`**

`gcloud --source` zips the working tree and rejects pre-1980 mtimes. Fix:

```sh
find . -path ./node_modules -prune -o -type f ! -newermt '1980-01-01' -print0 \
  | xargs -0 touch
```

Content is unchanged, so `git status` stays clean. Rare, and it tends to come
from a file copied off an old filesystem.

**`Error 403: does not have storage.objects.get`**

The compute service account cannot read the uploaded source:

```sh
gcloud projects add-iam-policy-binding starkupps-backend \
  --member="serviceAccount:261175458017-compute@developer.gserviceaccount.com" \
  --role="roles/storage.objectViewer"
```

**`Cannot find package 'ws'`**

`ws` is imported by `server/db/supabase.ts` but must be declared in
`dependencies`. If it is not, local runs may still work by resolving it from a
parent `node_modules` outside the repo, while the container has no such luck.

**`APP_URL must use https:// in production`**

Expected on a first deploy. `APP_URL` needs the URL Cloud Run assigns, which
only exists after the service is created. Deploy once, then set `APP_URL` and
redeploy.

---

## Cost

`min-instances 1` keeps one instance warm around the clock, so this bills
continuously rather than only on request. That is deliberate: it is what keeps
SSE streams alive. Without it, an idle stream is terminated when the service
scales to zero and order updates silently stop.

Cloud Run's free tier (180,000 vCPU-seconds, 360,000 GiB-seconds, 2M requests per
month) covers this workload. The GCP trial credit is separate and expires. Set a
budget alert before it does.