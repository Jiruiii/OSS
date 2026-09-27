#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// No credential enters a command argument, terminal output or committed file.
// --apply uploads only the explicitly named secrets to the selected repository.
const repository = process.env.GOVERNMENT_GITHUB_REPOSITORY || 'Jiruiii/OSS';
const project = process.env.CLOUDFLARE_PAGES_PROJECT || 'resilientgeo-feed';
const account = process.env.CLOUDFLARE_ACCOUNT_ID || '2b8f5303ae9ff872ba6fba7e4d74d619';
if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-z0-9-]+$/.test(project) || !/^[a-f0-9]{32}$/.test(account))
  throw new Error('Invalid deployment target');

function gh(args, input) {
  const result = spawnSync('gh', args, { input, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`GitHub operation failed (${args[0]} ${args[1]})`);
  return result.stdout;
}
async function configure() {
  const config = parseEnv(await readFile('pipeline/.env', 'utf8'));
  const token = (await readFile(process.env.CLOUDFLARE_API_TOKEN_FILE || '.stage2-keys/cloudflare-api-token.txt', 'utf8')).trim();
  if (!token || /\s/.test(token)) throw new Error('Missing or malformed deployment token file');
  const pem = await readFile('.stage2-keys/government-feed/private-key.pem', 'utf8');
  const trusted = JSON.parse(await readFile('android/app/src/main/assets/trust/trusted-keys.json', 'utf8'));
  const key = createPublicKey(createPrivateKey(pem)).export({ type: 'spki', format: 'der' }).toString('base64');
  if (trusted['government-feed-2026'] !== key) throw new Error('Signing key does not match the app');
  const secrets = {
    CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token,
    GOVERNMENT_SIGNING_PRIVATE_KEY: pem,
    NCDR_ALERT_API_KEY: config.NCDR_ALERT_API_KEY || config.NCDR_API_KEY,
    CWA_API_KEY: config.CWA_API_KEY,
    TDX_CLIENT_ID: config.TDX_CLIENT_ID, TDX_CLIENT_SECRET: config.TDX_CLIENT_SECRET,
  };
  for (const [name, value] of Object.entries(secrets)) if (!value) throw new Error(`Missing ${name}`);
  const repo = JSON.parse(gh(['repo', 'view', repository, '--json', 'nameWithOwner,viewerPermission']));
  if (!['ADMIN', 'MAINTAIN'].includes(repo.viewerPermission)) throw new Error('Repository secret administration is unavailable');
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${project}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000), redirect: 'error',
  });
  if (!response.ok || !(await response.json()).success) throw new Error('Deployment token cannot access the Pages project');
  console.log(`Validated signing key, API configuration and target ${repository} / ${project}`);
  if (!process.argv.includes('--apply')) {
    console.log('Read-only check complete. Use --apply to configure GitHub Actions secrets and variables.');
    return;
  }
  for (const [name, value] of Object.entries(secrets)) {
    gh(['secret', 'set', name, '--repo', repository], value);
    console.log(`Configured encrypted secret ${name}`);
  }
  const variables = { CLOUDFLARE_PAGES_PROJECT: project, GOVERNMENT_FEED_URL: `https://${project}.pages.dev/` };
  for (const [name, value] of Object.entries(variables)) {
    gh(['variable', 'set', name, '--repo', repository], value);
    console.log(`Configured variable ${name}`);
  }
  console.log('Configuration complete. Publish the workflow to the default branch, then run it without initial=true.');
}
configure().catch(error => {
  // Only our own fixed messages are shown; upstream bodies may contain secrets.
  const safe = /^(Invalid deployment target|Missing |Signing key |Repository secret |Deployment token |GitHub operation)/.test(error.message);
  console.error(safe ? error.message : 'Configuration failed; check local credential files and connectivity.');
  process.exitCode = 1;
});
