const jwt = require('jsonwebtoken');
const cookie = require('cookie');

const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const COOKIE_NAME = 'ecs_token';
const MAX_AGE = 60 * 60 * 8; // 8 hours, in seconds

function signUser(user) {
  return jwt.sign(user, SECRET, { expiresIn: MAX_AGE });
}

function setAuthCookie(res, user) {
  const token = signUser(user);
  res.setHeader('Set-Cookie', cookie.serialize(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE
  }));
}

function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', cookie.serialize(COOKIE_NAME, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0
  }));
}

function getUser(req) {
  const header = req.headers.cookie || '';
  const cookies = cookie.parse(header);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const { iat, exp, ...user } = jwt.verify(token, SECRET);
    return user;
  } catch (e) {
    return null;
  }
}

// Wraps a Vercel function handler, rejecting unauthenticated requests.
function requireAuth(handler) {
  return async (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    req.user = user;
    return handler(req, res);
  };
}

// Wraps a handler, requiring the user's role to be in `roles`.
// 'hr_director_or_above' now means HR Director only — System Administrator
// is intentionally excluded (admin = user/role management only, not approvals).
function requireRole(...roles) {
  const expanded = roles.flatMap(r => r === 'hr_director_or_above' ? ['hr_director'] : [r]);
  return (handler) => requireAuth(async (req, res) => {
    if (!expanded.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }
    return handler(req, res);
  });
}

// Reads a JSON body on Vercel Node functions (body may already be parsed).
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
    });
  });
}

module.exports = { setAuthCookie, clearAuthCookie, getUser, requireAuth, requireRole, readBody };
