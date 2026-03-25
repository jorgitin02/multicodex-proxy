const targetUrl =
  process.env.MONITOR_TARGET_URL ?? "http://127.0.0.1:4010/health";
const alertWebhook = process.env.MONITOR_ALERT_WEBHOOK;
const githubToken = process.env.MONITOR_GITHUB_TOKEN;
const githubRepo = process.env.MONITOR_GITHUB_REPO;

async function createGitHubIssue(message) {
  if (!githubToken || !githubRepo) return;
  await fetch(`https://api.github.com/repos/${githubRepo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: `Health check failed: ${new Date().toISOString()}`,
      body: message,
      labels: ["bug", "priority:high", "area:infra"],
    }),
  });
}

async function sendWebhook(message) {
  if (!alertWebhook) return;
  await fetch(alertWebhook, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: message,
    }),
  });
}

const response = await fetch(targetUrl);
if (!response.ok) {
  const message = `Health check failed for ${targetUrl}: HTTP ${response.status}`;
  await Promise.all([sendWebhook(message), createGitHubIssue(message)]);
  throw new Error(message);
}

const body = await response.json();
if (!body?.ok || body?.ready === false) {
  const message = `Health check returned degraded payload for ${targetUrl}: ${JSON.stringify(body)}`;
  await Promise.all([sendWebhook(message), createGitHubIssue(message)]);
  throw new Error(message);
}
