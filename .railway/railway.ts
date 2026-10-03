/**
 * Tempo on Railway: the hosting setup, written as code.
 *
 * What this file is: a description of the one service Tempo needs on Railway (built from the
 * Dockerfile in this repository) and the one disk it keeps its database on. It replaces the older
 * railway.json / railway.toml files, which Railway no longer accepts for new services.
 *
 * How to use it (once, from your computer, in this folder):
 *   1. railway link          Pick or create the Railway project this should belong to.
 *   2. railway config plan   Shows what would change. Nothing is changed yet; read it.
 *   3. railway config apply  Makes those changes: creates the "tempo" service and its disk.
 *   4. railway variable set BASE_URL=https://your-address ANTHROPIC_API_KEY=sk-ant-...
 *                            Secrets and your public address are NOT kept in this file, because this
 *                            file is saved in git. Set them with the command on this line (or in the
 *                            dashboard under the service's Variables tab). BASE_URL is the public https
 *                            address of your Tempo with no trailing slash. Give the service a public
 *                            address first (railway domain, or Settings > Networking in the dashboard).
 *   5. railway up            Builds the image and starts Tempo. Later updates are the same command.
 *   6. railway ssh           Opens a shell inside the running container. There, run
 *                            node dist/server/cli/setup.js
 *                            to create the first admin (it asks for a name, email and password).
 *
 * If you would rather click than type: every setting below is also in the Railway dashboard.
 * Create a service from this repository (it finds the Dockerfile), add a volume mounted at /data,
 * set the healthcheck path to /healthz, turn Serverless (app sleeping) off, and add the variables
 * listed under "env". The result is identical.
 *
 * Why the settings are what they are:
 *   - Tempo runs its scheduler inside the same process as the web server, so it must never sleep:
 *     sleepApplication is false and the restart policy is ALWAYS.
 *   - The database is a file on the disk mounted at /data. Railway mounts disks only while the
 *     container is running (not during the build), so Tempo creates and upgrades its tables when it
 *     starts. Railway never runs two deployments on one disk at the same time, so an update stops
 *     the old Tempo before the new one starts; expect a few seconds of downtime per deploy.
 *   - The healthcheck asks /healthz, which only answers when the database is readable. Railway
 *     waits up to healthcheckTimeout seconds for it before it switches traffic to the new deploy.
 *   - drainingSeconds gives the old process time to close the web server, flush the database to
 *     disk and exit cleanly when Railway stops it (Tempo handles SIGTERM, and needs about 10 s at most).
 *   - The container runs as root (the Dockerfile sets no USER). Railway mounts the disk owned by
 *     root, and a non-root user would not be able to write to it. This is the simplest setup that
 *     is known to work. If you ever switch to a non-root user, set RAILWAY_RUN_UID=0 as well so
 *     the volume stays writable.
 *   - PORT is not set here: Railway provides it and Tempo listens on it.
 */
import { defineRailway, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  // Tempo's database, its nightly backups and nothing else. 1 GB is plenty for years of reports;
  // you can grow it later in the dashboard.
  const data = volume("data", { sizeMB: 1024 });

  const tempo = service("tempo", {
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    deploy: {
      healthcheckPath: "/healthz",
      healthcheckTimeout: 120,
      restartPolicyType: "ALWAYS",
      sleepApplication: false,
      drainingSeconds: 15,
    },
    // Plain settings only. Secrets (ANTHROPIC_API_KEY, SMTP_PASS, ...) and BASE_URL are set with
    // `railway variable set`, never here.
    env: {
      NODE_ENV: "production",
      DATA_DIR: "/data",
      TRUST_PROXY: "true",
    },
    volumeMounts: { "/data": data },
  });

  return project("tempo", { resources: [tempo, data] });
});
