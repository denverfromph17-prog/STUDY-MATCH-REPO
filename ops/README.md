# Study Match PH single-instance pilot runbook

This runbook is for the approved pilot only: one DigitalOcean Droplet in `sgp1`, Ubuntu 24.04 LTS, 1 vCPU/2 GiB RAM, one Node process, Caddy, and a 20 GiB ext4 volume. Do not deploy a second application instance against this SQLite database.

## Paths and ownership

| Purpose | Path | Owner/mode |
|---|---|---|
| Release | `/opt/study-match/current` | root-owned, application-readable |
| Application environment | `/etc/study-match/study-match.env` | `root:studymatch`, `0640` |
| Backup environment | `/etc/study-match/backup.env` | `root:root`, `0600` |
| Restic password | `/etc/study-match/restic-password` | `root:root`, `0600` |
| Persistent volume | `/srv/study-match-data` | dedicated ext4 mount |
| SQLite database | `/srv/study-match-data/database/study-match.db` | `studymatch:studymatch` |
| Profile photos | `/srv/study-match-data/uploads/profile-photos` | `studymatch:studymatch` |

Never place SQLite on NFS, SMB, OneDrive, or another network/synchronized filesystem. Mount the DigitalOcean block volume by filesystem UUID in `/etc/fstab` with `defaults,nofail` and verify it is mounted before starting the service. `RequiresMountsFor` prevents the application and backup from silently using the root filesystem when the volume is absent.

## Initial host setup

1. Apply Ubuntu security updates and install Node.js 22, Caddy, `sqlite3`, `restic`, `curl`, and `ufw`. Enable automatic security updates.
2. Create the locked system account: `sudo useradd --system --home /nonexistent --shell /usr/sbin/nologin studymatch`.
3. Format the new, empty 20 GiB volume as ext4, mount it at `/srv/study-match-data`, add its UUID to `/etc/fstab`, then run `findmnt -M /srv/study-match-data`.
4. Create the database and upload directories owned by `studymatch:studymatch` with mode `0750`.
5. Deploy an immutable release under `/opt/study-match`, install production dependencies with the lockfile, and point `/opt/study-match/current` to the approved release. Do not run the application from a writable upload or data directory.
6. Copy `ops/env/study-match.env.example` to `/etc/study-match/study-match.env`. Keep the approved values, including `HOST=127.0.0.1`, `PORT=3000`, `NODE_ENV=production`, and `TRUST_PROXY=1`.
7. Copy the systemd units to `/etc/systemd/system`, run `sudo systemctl daemon-reload`, enable `study-match.service`, and confirm `ss -ltnp` shows Node only on `127.0.0.1:3000`.

Run `systemd-analyze security study-match.service` after installation. Reassess any distribution-specific warning before changing the unit; do not add a hardening directive that prevents Node or SQLite from operating.

## Caddy, TLS, and firewall

Replace `study.example.com` in `ops/caddy/Caddyfile` with the real production hostname, validate with `caddy validate --config`, install it as `/etc/caddy/Caddyfile`, and reload Caddy. DNS must point only to this Droplet. Caddy obtains and renews public certificates and forwards exactly one trusted proxy hop to Node.

The Caddy template discards an inbound `X-Forwarded-For` value and sets forwarding headers from the actual peer. This is why the exact application setting is `TRUST_PROXY=1`. Never expose port 3000 publicly and do not change that value while this topology remains Caddy directly in front of Node. After seven incident-free days of HTTPS validation, the HSTS duration may be increased deliberately; do not add `includeSubDomains` unless every subdomain is HTTPS-ready.

Configure both the DigitalOcean Cloud Firewall and UFW:

- inbound TCP 80 and 443 from anywhere;
- inbound TCP 22 only from known administrator IPs where practical;
- no public inbound rule for 3000;
- outbound DNS, NTP, Ubuntu updates, Better Stack, DigitalOcean telemetry, and Backblaze B2 HTTPS as required.

Verify HTTP redirects to HTTPS, the certificate chain and renewal timer, secure session cookies, login/logout through Caddy, and that spoofed forwarding headers cannot alter the client identity. These are **external deployment verifications** and cannot be proven by repository tests.

## Backups

Backups use `sqlite3 .backup`, not a live file copy. The script validates the persistent mount and paths, rejects upload symlinks, takes a lock, briefly stops the single application service, checkpoints WAL, creates an online SQLite backup, validates database integrity and foreign keys, archives uploads, writes checksums, and restarts the app before sending the encrypted payload to B2.

Create a private Backblaze B2 bucket in EU Central and a bucket-scoped application key with only the permissions Restic needs. Copy `ops/env/backup.env.example` to `/etc/study-match/backup.env`, fill it only on the server, and create a high-entropy Restic password file. The key, password, bucket identifiers, and Better Stack heartbeat tokens must never enter Git, shell history, tickets, or logs.

Initialize once with the deployed environment loaded and `restic init`. Then enable the timer:

```text
sudo systemctl enable --now study-match-backup.timer
sudo systemctl list-timers study-match-backup.timer
sudo systemctl start study-match-backup.service
sudo journalctl -u study-match-backup.service
```

The schedule is exactly every six hours without scheduler jitter. Retention is 28 hourly, 30 daily, 12 weekly, and 12 monthly snapshots; `forget --prune` enforces it after a successful backup. This supports the pilot target of RPO 6 hours. Alert if no success heartbeat arrives within 7 hours, any failure heartbeat occurs, B2 capacity/billing becomes abnormal, or local disk free space drops below 20%.

The deliberate brief write outage is appropriate for the single-instance pilot and makes the SQLite and upload snapshot consistent. Measure it during the first backup. If it exceeds the maintenance tolerance, investigate data size and upload growth rather than running concurrent instances.

## Restore verification and disaster recovery

The weekly timer restores the latest encrypted snapshot to an isolated temporary directory. It validates checksums, SQLite integrity, foreign keys, archive paths, extraction, and every database-referenced profile photo. It never overwrites production data. Enable it with `sudo systemctl enable --now study-match-restore-verify.timer` and alert if its heartbeat is older than eight days.

Once a month, conduct and record a full restore drill on an isolated replacement Droplet or temporary directory:

1. Record the incident/drill start time and latest usable snapshot time.
2. Provision an isolated Ubuntu host with the same package versions; do not attach it to production DNS.
3. Restore the selected Restic snapshot and run `verify-restore.sh --local PATH_TO_PAYLOAD`.
4. Extract `uploads.tar.gz` into a new empty upload directory and place the verified database in a new empty database directory.
5. Start one application process with temporary paths, query `/api/ready`, and exercise login plus profile-photo retrieval with a designated test account. Do not use real user credentials in the drill record.
6. Record elapsed time, snapshot age, integrity output, missing-object count, and corrective actions. Delete the isolated plaintext copy securely according to the provider's storage lifecycle.

For a real recovery, keep the original damaged volume read-only, stop Study Match, restore into a **new** ext4 volume, verify it, correct ownership/modes, update mount configuration, then start the single service. Never extract over the active database or uploads. Validate `/api/ready` before returning DNS/traffic. The pilot targets RTO 4 hours.

Possession of the B2 data alone is insufficient without the Restic password. Store an offline recovery copy of the password and B2 recovery instructions in an organization-approved password vault, with access tested during each drill.

## Monitoring and alerts

Enable the DigitalOcean agent and alerts for Droplet down, CPU above 85% for 15 minutes, memory above 85% for 15 minutes, disk usage above 80%, and disk growth. Send notifications to at least two accountable operators.

Configure Better Stack to check the public `/api/health` endpoint every minute and `/api/ready` every minute. Alert after two consecutive failures and confirm recovery notifications. Add heartbeat monitors for the six-hour backup and weekly restore verification using the server-only URLs in `backup.env`. Monitor Caddy 5xx rate and journald for application restarts, authentication rate-limit spikes, and backup errors. Never send request cookies, authorization data, private messages, profile data, or query strings to monitoring services.

## Readiness checklist

Before pilot traffic:

- confirm `origin/master` is the approved release and dependency/security checks pass;
- validate systemd units and the Caddy config on Ubuntu 24.04;
- verify the ext4 volume mount, ownership, free-space alert, and reboot behavior;
- verify Node listens only on loopback and only ports 80/443 plus restricted SSH are public;
- test TLS, redirect, certificate renewal, proxy headers, secure cookies, and CSRF behavior through the public hostname;
- run one backup, inspect it with `restic snapshots`, run restore verification, and complete a timed restore drill;
- confirm RPO/RTO, monitoring routes, escalation ownership, privacy requests, incident response, and moderation procedures;
- complete Firefox and Safari/WebKit browser testing and a documented pilot load test.

Firefox, Safari/WebKit, provider firewall, DNS/TLS, B2 lifecycle, alerts, restore timing, and load behavior are **REQUIRES EXTERNAL/DEPLOYMENT VERIFICATION**.

## SQLite exit criteria

Keep SQLite only while all of these remain true: one application process; the database stays on its local ext4 block volume; observed p95 write latency and lock waits remain acceptable; backup and restore complete inside RPO/RTO; storage growth remains operationally manageable; and the pilot load test plus production metrics leave at least 2x headroom.

Plan and test a PostgreSQL migration before any of these events:

- a second application instance, rolling zero-downtime deployment, autoscaling, or multiple regions are required;
- sustained write contention, `SQLITE_BUSY` events, or p95 API latency violates the service objective;
- the measured peak workload cannot retain 2x headroom on this Droplet;
- database size or backup/restore duration threatens the 6-hour RPO or 4-hour RTO;
- availability requirements can no longer tolerate the single-host failure domain or backup maintenance pause;
- reporting, operational access, or recovery needs require managed replication, point-in-time recovery, or independent read capacity.

Before multi-instance deployment, PostgreSQL and a shared rate limiter are both required. Migration must be a separately approved project with data reconciliation, rollback, performance, and recovery tests; it is not part of this pilot package.

## Operational ownership

Name primary and secondary owners for deployment, backup alerts, restore authority, security incidents, privacy requests, and moderation escalations. Document data retention/deletion rules, user export/deletion handling, evidence preservation, abuse escalation, breach notification, and least-privilege access outside the repository in the organization's controlled procedures. Review access quarterly and after personnel changes.
