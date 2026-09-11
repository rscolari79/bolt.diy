import { createHash, timingSafeEqual } from 'node:crypto';

const REALM = 'bolt.diy';

/**
 * Compare two strings without leaking their contents or their length through
 * timing. Hashing first gives both sides a fixed width, which timingSafeEqual
 * requires and which also hides length differences.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeEqual(a, b) {
  const digestA = createHash('sha256').update(String(a), 'utf8').digest();
  const digestB = createHash('sha256').update(String(b), 'utf8').digest();

  return timingSafeEqual(digestA, digestB);
}

/**
 * Decode an HTTP Basic Authorization header.
 *
 * @param {string | undefined} header
 * @returns {{ user: string, password: string } | undefined}
 */
export function parseBasicAuth(header) {
  if (typeof header !== 'string' || !header.toLowerCase().startsWith('basic ')) {
    return undefined;
  }

  const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');

  if (separator === -1) {
    return undefined;
  }

  return { user: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
}

/**
 * Express middleware enforcing HTTP Basic auth.
 *
 * Returns a pass-through when either credential is unset, so an operator who
 * does not configure BOLT_AUTH_USER / BOLT_AUTH_PASSWORD gets the previous
 * open behaviour rather than a locked-out instance.
 *
 * `publicPaths` stays reachable unauthenticated — a platform healthcheck
 * cannot send credentials.
 *
 * @param {{ user?: string, password?: string, publicPaths?: string[] }} options
 */
export function createBasicAuth({ user, password, publicPaths = ['/api/health'] }) {
  if (!user || !password) {
    return function noAuth(_req, _res, next) {
      next();
    };
  }

  return function basicAuth(req, res, next) {
    if (publicPaths.includes(req.path)) {
      next();
      return;
    }

    const credentials = parseBasicAuth(req.headers.authorization);

    if (credentials && safeEqual(credentials.user, user) && safeEqual(credentials.password, password)) {
      next();
      return;
    }

    res.setHeader('WWW-Authenticate', `Basic realm="${REALM}", charset="UTF-8"`);
    res.status(401).send('Authentication required');
  };
}
