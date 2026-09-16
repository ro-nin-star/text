const MESSAGE_LABEL = "message";
const ADMIN_REPLY_PREFIX = "**ronin (admin):**";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 óra
const MAX_TEXT_LENGTH = 1000;
const MAX_AUTHOR_LENGTH = 50;

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function json(data, status, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(env),
    },
  });
}

function githubHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "text-uzenetfal-worker",
  };
}

function githubApiUrl(env, path) {
  return `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}${path}`;
}

function parseMessageBody(body) {
  const match = /^\*\*Feladó:\*\* (.*)\n\n([\s\S]*)$/.exec(body || "");
  if (!match) {
    return { author: "Anonim", text: body || "" };
  }
  return { author: match[1].trim(), text: match[2] };
}

function parseCommentBody(body) {
  if ((body || "").startsWith(ADMIN_REPLY_PREFIX)) {
    return {
      author: "ronin",
      text: body.slice(ADMIN_REPLY_PREFIX.length).replace(/^\n+/, ""),
    };
  }
  return { author: "ismeretlen", text: body || "" };
}

function toBase64Url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toBase64Url(new Uint8Array(signature));
}

async function createSessionToken(env) {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `ronin:${exp}`;
  const signature = await hmac(env.SESSION_SECRET, payload);
  return `${payload}:${signature}`;
}

async function verifySessionToken(env, token) {
  if (!token) return false;
  const parts = token.split(":");
  if (parts.length !== 3 || parts[0] !== "ronin") return false;
  const [role, expStr, signature] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const expected = await hmac(env.SESSION_SECRET, `${role}:${expStr}`);
  return expected === signature;
}

function getBearerToken(request) {
  const header = request.headers.get("Authorization") || "";
  const match = /^Bearer (.+)$/.exec(header);
  return match ? match[1] : null;
}

async function requireAdmin(request, env) {
  const token = getBearerToken(request);
  return verifySessionToken(env, token);
}

async function fetchComments(env, issueNumber) {
  const res = await fetch(githubApiUrl(env, `/issues/${issueNumber}/comments?per_page=100`), {
    headers: githubHeaders(env),
  });
  if (!res.ok) return [];
  const comments = await res.json();
  return comments.map((c) => ({
    ...parseCommentBody(c.body),
    createdAt: c.created_at,
  }));
}

async function toMessageDto(env, issue, includeComments) {
  const { author, text } = parseMessageBody(issue.body);
  const dto = {
    id: issue.number,
    author,
    text,
    createdAt: issue.created_at,
    state: issue.state,
  };
  if (includeComments) {
    dto.replies = await fetchComments(env, issue.number);
  }
  return dto;
}

async function listMessages(env, state) {
  const res = await fetch(
    githubApiUrl(env, `/issues?labels=${MESSAGE_LABEL}&state=${state}&per_page=100&sort=created&direction=desc`),
    { headers: githubHeaders(env) }
  );
  if (!res.ok) {
    throw new Error(`GitHub API hiba (${res.status}): ${await res.text()}`);
  }
  const issues = await res.json();
  return Promise.all(issues.map((issue) => toMessageDto(env, issue, true)));
}

function sanitizeAuthor(author) {
  const trimmed = (author || "").trim();
  if (!trimmed) return "Anonim";
  return trimmed.slice(0, MAX_AUTHOR_LENGTH);
}

async function handleGetMessages(env) {
  const messages = await listMessages(env, "open");
  return json(messages, 200, env);
}

async function handlePostMessage(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.text !== "string" || !body.text.trim()) {
    return json({ error: "A szöveg mező kötelező." }, 400, env);
  }
  if (body.text.length > MAX_TEXT_LENGTH) {
    return json({ error: `A szöveg legfeljebb ${MAX_TEXT_LENGTH} karakter lehet.` }, 400, env);
  }
  const author = sanitizeAuthor(body.author);
  const text = body.text.trim();
  const title = `Üzenet – ${author}`.slice(0, 100);
  const issueBody = `**Feladó:** ${author}\n\n${text}`;

  const res = await fetch(githubApiUrl(env, "/issues"), {
    method: "POST",
    headers: { ...githubHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({ title, body: issueBody, labels: [MESSAGE_LABEL] }),
  });
  if (!res.ok) {
    return json({ error: `Nem sikerült létrehozni az üzenetet (${res.status}).` }, 502, env);
  }
  const issue = await res.json();
  return json(await toMessageDto(env, issue, false), 201, env);
}

async function handleAdminLogin(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.password !== "string") {
    return json({ error: "Jelszó megadása kötelező." }, 400, env);
  }
  if (body.password !== env.ADMIN_PASSWORD) {
    return json({ error: "Hibás jelszó." }, 401, env);
  }
  const token = await createSessionToken(env);
  return json({ token }, 200, env);
}

async function handleAdminMessages(request, env) {
  if (!(await requireAdmin(request, env))) {
    return json({ error: "Nincs jogosultság." }, 401, env);
  }
  const messages = await listMessages(env, "all");
  return json(messages, 200, env);
}

async function handleAdminReply(request, env) {
  if (!(await requireAdmin(request, env))) {
    return json({ error: "Nincs jogosultság." }, 401, env);
  }
  const body = await request.json().catch(() => null);
  if (!body || !Number.isFinite(body.issueId) || typeof body.text !== "string" || !body.text.trim()) {
    return json({ error: "issueId és text mező kötelező." }, 400, env);
  }
  if (body.text.length > MAX_TEXT_LENGTH) {
    return json({ error: `A szöveg legfeljebb ${MAX_TEXT_LENGTH} karakter lehet.` }, 400, env);
  }
  const commentBody = `${ADMIN_REPLY_PREFIX}\n\n${body.text.trim()}`;
  const res = await fetch(githubApiUrl(env, `/issues/${body.issueId}/comments`), {
    method: "POST",
    headers: { ...githubHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({ body: commentBody }),
  });
  if (!res.ok) {
    return json({ error: `Nem sikerült elküldeni a választ (${res.status}).` }, 502, env);
  }
  const comment = await res.json();
  return json({ ...parseCommentBody(comment.body), createdAt: comment.created_at }, 201, env);
}

async function setIssueState(request, env, state) {
  if (!(await requireAdmin(request, env))) {
    return json({ error: "Nincs jogosultság." }, 401, env);
  }
  const body = await request.json().catch(() => null);
  if (!body || !Number.isFinite(body.issueId)) {
    return json({ error: "issueId mező kötelező." }, 400, env);
  }
  const res = await fetch(githubApiUrl(env, `/issues/${body.issueId}`), {
    method: "PATCH",
    headers: { ...githubHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
  });
  if (!res.ok) {
    return json({ error: `Nem sikerült módosítani az üzenet állapotát (${res.status}).` }, 502, env);
  }
  const issue = await res.json();
  return json(await toMessageDto(env, issue, false), 200, env);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    try {
      if (url.pathname === "/api/messages" && request.method === "GET") {
        return await handleGetMessages(env);
      }
      if (url.pathname === "/api/messages" && request.method === "POST") {
        return await handlePostMessage(request, env);
      }
      if (url.pathname === "/api/admin/login" && request.method === "POST") {
        return await handleAdminLogin(request, env);
      }
      if (url.pathname === "/api/admin/messages" && request.method === "POST") {
        return await handleAdminMessages(request, env);
      }
      if (url.pathname === "/api/admin/reply" && request.method === "POST") {
        return await handleAdminReply(request, env);
      }
      if (url.pathname === "/api/admin/hide" && request.method === "POST") {
        return await setIssueState(request, env, "closed");
      }
      if (url.pathname === "/api/admin/unhide" && request.method === "POST") {
        return await setIssueState(request, env, "open");
      }
      return json({ error: "Nem található végpont." }, 404, env);
    } catch (err) {
      return json({ error: err.message || "Ismeretlen szerverhiba." }, 500, env);
    }
  },
};
