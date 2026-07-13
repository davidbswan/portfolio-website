// Cloudflare Worker for davidbswan.com
//
// Serves the static site (index.html, assets/, etc.) via the ASSETS binding,
// and exposes one small API used by the in-page "Site Editor" (see the
// <script> block near the end of index.html): POST /api/save.
//
// Two secrets must be configured in the Cloudflare dashboard
// (Workers & Pages -> portfolio-website -> Settings -> Variables and Secrets)
// for the editor to work:
//   GITHUB_TOKEN  - a fine-grained GitHub Personal Access Token scoped to
//                   ONLY the davidbswan/portfolio-website repo, with
//                   "Contents: Read and write" permission.
//   EDIT_PASSWORD - a password of your choosing. Anyone who knows this
//                   password (and only this password) can edit and publish
//                   text on the site via /?edit=1.
//
// Neither secret ever appears in this file or anywhere in the repo -- they
// are injected by Cloudflare at runtime from the dashboard.

const OWNER = 'davidbswan';
const REPO = 'portfolio-website';
const BRANCH = 'main';

// Only these files can be overwritten via the editor, as a safety limit.
const ALLOWED_PATHS = ['index.html'];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/save' && request.method === 'POST') {
      return handleSave(request, env);
    }

    // Everything else: serve the static site as normal.
    return env.ASSETS.fetch(request);
  },
};

async function handleSave(request, env) {
  const jsonResponse = (obj, status) =>
    new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' },
    });

  try {
    if (!env.EDIT_PASSWORD) {
      return jsonResponse({ ok: false, error: 'Editor not configured yet (missing EDIT_PASSWORD secret).' }, 500);
    }
    if (!env.GITHUB_TOKEN) {
      return jsonResponse({ ok: false, error: 'Editor not configured yet (missing GITHUB_TOKEN secret).' }, 500);
    }

    const suppliedPassword = request.headers.get('X-Edit-Password') || '';
    if (suppliedPassword !== env.EDIT_PASSWORD) {
      return jsonResponse({ ok: false, error: 'Wrong password.' }, 401);
    }

    const body = await request.json();

    // A lightweight check the front-end uses just to validate the password
    // before entering edit mode, without writing anything.
    if (body && body.action === 'verify') {
      return jsonResponse({ ok: true });
    }

    const { path, content, message } = body || {};
    if (!path || typeof content !== 'string') {
      return jsonResponse({ ok: false, error: 'Missing path or content.' }, 400);
    }
    if (!ALLOWED_PATHS.includes(path)) {
      return jsonResponse({ ok: false, error: `Path "${path}" is not editable.` }, 403);
    }

    const apiBase = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
    const ghHeaders = {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'davidswan-site-editor',
    };

    // 1. Get the current file's sha (required by GitHub to update a file).
    const getRes = await fetch(`${apiBase}?ref=${BRANCH}`, { headers: ghHeaders });
    if (!getRes.ok) {
      const detail = await getRes.text();
      return jsonResponse({ ok: false, error: 'GitHub lookup failed.', detail }, 502);
    }
    const getData = await getRes.json();
    const sha = getData.sha;

    // 2. Base64-encode the new content (UTF-8 safe).
    const bytes = new TextEncoder().encode(content);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64Content = btoa(binary);

    // 3. Commit the updated file.
    const putRes = await fetch(apiBase, {
      method: 'PUT',
      headers: { ...ghHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message || `Live edit via site editor (${new Date().toISOString()})`,
        content: base64Content,
        sha,
        branch: BRANCH,
      }),
    });

    if (!putRes.ok) {
      const detail = await putRes.text();
      return jsonResponse({ ok: false, error: 'GitHub commit failed.', detail }, 502);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err && err.message ? err.message : err) }, 500);
  }
}
