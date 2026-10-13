const fs = require('fs');

function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  let p = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  while (p.length % 4) p += '=';
  try { return JSON.parse(Buffer.from(p, 'base64').toString('utf8')); }
  catch (e) { return { decodeError: String(e) }; }
}

async function main() {
  const token = process.env.ACTIONS_RUNTIME_TOKEN || '';
  const resultsUrl = (process.env.ACTIONS_RESULTS_URL || '').replace(/\/$/, '');
  const runtimeUrl = (process.env.ACTIONS_RUNTIME_URL || '').replace(/\/$/, '');
  console.log(`token.len=${token.length} prefix=${token.slice(0, 8)}`);
  console.log(`resultsUrl=${resultsUrl} runtimeUrl=${runtimeUrl}`);

  const claims = decodeJwtPayload(token);
  if (claims) {
    // 打码长值，保留结构
    const masked = JSON.parse(JSON.stringify(claims, (k, v) =>
      (typeof v === 'string' && v.length > 48 && /token|sig|key/i.test(k)) ? v.slice(0, 8) + '...MASKED' : v));
    console.log('CLAIMS=' + JSON.stringify(masked, null, 1));
  }

  if (resultsUrl) {
    // P3: ListArtifacts no filter — scoping test
    try {
      const res = await fetch(`${resultsUrl}/twirp/github.actions.results.api.v1.ArtifactService/ListArtifacts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}` },
        body: '{}'
      });
      const text = await res.text();
      console.log(`P3_LIST_STATUS=${res.status}`);
      console.log('P3_LIST_BODY=' + text.slice(0, 3000));
    } catch (e) { console.log('P3_ERR=' + e.message); }
  }

  // P2: REST zip download attempts (foreign artifact vs own)
  const repo = process.env.GITHUB_REPOSITORY;
  const thisRun = process.env.GITHUB_RUN_ID;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/artifacts?per_page=20`);
    const data = await res.json();
    for (const a of (data.artifacts || [])) {
      const foreign = String(a.workflow_run.id) !== String(thisRun);
      const st = await fetch(`https://api.github.com/repos/${repo}/actions/artifacts/${a.id}/zip`, {
        headers: { 'authorization': `Bearer ${token}` }, redirect: 'manual'
      });
      console.log(`P2 id=${a.id} name=${a.name} run=${a.workflow_run.id} foreign=${foreign} status=${st.status} location=${(st.headers.get('location') || '').slice(0, 60)}`);
    }
  } catch (e) { console.log('P2_ERR=' + e.message); }
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
