const action = process.argv[2];
const deploymentId = process.argv[3] || `deploy-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const timeoutSeconds = Number(process.argv[4] || process.env.MOVA_DEPLOY_READY_TIMEOUT || 900);
const baseUrl = String(process.env.MOVA_DEPLOY_URL || '').replace(/\/$/, '');
const secret = process.env.MOVA_DEPLOY_HOOK_SECRET || '';

if (!['on', 'off', 'status', 'wait-ready'].includes(action || '')) {
  console.error('Usage: pnpm maintenance <on|off|status|wait-ready> [deployment-id] [timeout-seconds]');
  process.exit(2);
}
if (!baseUrl) {
  console.error('MOVA_DEPLOY_URL is required');
  process.exit(2);
}
if (action !== 'status' && !secret) {
  console.error('MOVA_DEPLOY_HOOK_SECRET is required');
  process.exit(2);
}

async function get(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { accept: 'application/json' } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `${path} returned HTTP ${response.status}`);
  return result;
}

async function update(active, extra = {}) {
  const response = await fetch(`${baseUrl}/api/maintenance`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ active, deploymentId, ...extra }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Maintenance hook returned HTTP ${response.status}`);
  return result;
}

async function waitReady() {
  const state = await get('/api/maintenance');
  if (!state.active || state.deploymentId !== deploymentId) throw new Error(`Maintenance is not active for ${deploymentId}`);
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    try {
      const readiness = await get('/api/ready');
      if (readiness.ok && readiness.instanceId && readiness.instanceId !== state.previousInstanceId) {
        await update(false);
        const confirmed = await get('/api/maintenance');
        if (confirmed.active) throw new Error('Maintenance state remained active after readiness confirmation');
        return readiness;
      }
    } catch (error) {
      if (Date.now() + 2000 >= deadline) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`New backend did not become ready within ${timeoutSeconds} seconds; maintenance remains active`);
}

try {
  let result;
  if (action === 'status') result = await get('/api/maintenance');
  if (action === 'on') {
    const readiness = await get('/api/ready');
    if (!readiness.ok || !readiness.instanceId) throw new Error('Current backend did not confirm readiness');
    result = await update(true, { previousInstanceId: readiness.instanceId });
  }
  if (action === 'off') result = await update(false);
  if (action === 'wait-ready') result = await waitReady();
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
