# Self-hosted deploy runbook

## Deploy

```bash
docker compose up -d --build
```

## Validate

```bash
curl http://localhost:4010/health
curl http://localhost:4010/ready
npm run monitor:health
```

## Roll back

1. Check the previous image or commit you want to restore.
2. Rebuild or redeploy that known-good revision.
3. Re-run the health and readiness checks.
4. Verify request routing from the dashboard traces tab.

## Continuous local monitoring

- Install `ops/systemd/multivibe-monitor.service` and `ops/systemd/multivibe-monitor.timer`.
- Optionally set `MONITOR_ALERT_WEBHOOK` for chat/webhook alerting.
- Optionally set `MONITOR_GITHUB_REPO` and `MONITOR_GITHUB_TOKEN` to open an issue automatically on failures.
