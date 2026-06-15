// Vercel serverless function - handles read/write of check data via GitHub API
// Stores data in data.json in the repo, using GitHub Contents API
// Uses Node.js runtime (default) - Buffer is available

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = 'CHY-11';
const REPO_NAME = 'daily-checkin';
const DATA_PATH = 'data.json';
const API_BASE = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DATA_PATH}`;

// In-memory cache (reused across warm function invocations)
const CACHE = { data: null, sha: null, ts: 0 };
const CACHE_TTL = 3000; // 3 seconds

async function fetchRemote() {
  const res = await fetch(API_BASE, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'daily-checkin-app',
    },
  });

  if (res.status === 404) {
    return { data: {}, sha: null };
  }

  if (!res.ok) {
    throw new Error(`GitHub fetch failed: ${res.status}`);
  }

  const json = await res.json();
  const content = JSON.parse(
    Buffer.from(json.content, 'base64').toString('utf8')
  );
  return { data: content, sha: json.sha };
}

async function writeRemote(data, sha) {
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');

  const body = { message: 'Update check data', content };
  if (sha) body.sha = sha;

  const res = await fetch(API_BASE, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'daily-checkin-app',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub write failed: ${res.status} ${err.message || ''}`);
  }

  const json = await res.json();
  return { sha: json.content.sha };
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    if (req.method === 'GET') {
      let data;
      if (CACHE.data && Date.now() - CACHE.ts < CACHE_TTL) {
        data = CACHE.data;
      } else {
        const remote = await fetchRemote();
        data = remote.data;
        CACHE.data = data;
        CACHE.sha = remote.sha;
        CACHE.ts = Date.now();
      }
      return res.json(data);

    } else if (req.method === 'POST') {
      const { key, value } = req.body;
      if (!key) {
        return res.status(400).json({ error: 'Missing key' });
      }

      const remote = await fetchRemote();
      const data = remote.data;
      const sha = remote.sha;

      if (value) {
        data[key] = true;
      } else {
        delete data[key];
      }

      const result = await writeRemote(data, sha);
      CACHE.data = data;
      CACHE.sha = result.sha;
      CACHE.ts = Date.now();

      return res.json({ ok: true });

    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    console.error('API Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
