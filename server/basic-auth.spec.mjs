import { describe, expect, it, vi } from 'vitest';
import { createBasicAuth, parseBasicAuth } from './basic-auth.mjs';

function makeReq(urlPath, authorization) {
  return { path: urlPath, headers: authorization ? { authorization } : {} };
}

function makeRes() {
  return {
    statusCode: undefined,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
}

const encode = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

describe('parseBasicAuth', () => {
  it('decodes a well-formed header', () => {
    expect(parseBasicAuth(encode('ada', 'hunter2'))).toEqual({ user: 'ada', password: 'hunter2' });
  });

  it('keeps colons inside the password', () => {
    expect(parseBasicAuth(encode('ada', 'a:b:c'))).toEqual({ user: 'ada', password: 'a:b:c' });
  });

  it('accepts a lowercase scheme', () => {
    const header = encode('ada', 'hunter2').replace('Basic ', 'basic ');
    expect(parseBasicAuth(header)).toEqual({ user: 'ada', password: 'hunter2' });
  });

  it('returns undefined for a missing header', () => {
    expect(parseBasicAuth(undefined)).toBeUndefined();
  });

  it('returns undefined for a non-basic scheme', () => {
    expect(parseBasicAuth('Bearer abc')).toBeUndefined();
  });

  it('returns undefined when the decoded value has no colon', () => {
    expect(parseBasicAuth(`Basic ${Buffer.from('nocolon').toString('base64')}`)).toBeUndefined();
  });
});

describe('createBasicAuth', () => {
  it('passes everything through when no credentials are configured', () => {
    const next = vi.fn();
    const res = makeRes();

    createBasicAuth({ user: undefined, password: undefined })(makeReq('/'), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeUndefined();
  });

  it('passes through when only the user is configured', () => {
    const next = vi.fn();
    const res = makeRes();

    createBasicAuth({ user: 'ada', password: '' })(makeReq('/'), res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects a request without credentials', () => {
    const next = vi.fn();
    const res = makeRes();

    createBasicAuth({ user: 'ada', password: 'hunter2' })(makeReq('/'), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain('Basic realm=');
  });

  it('rejects a wrong password', () => {
    const next = vi.fn();
    const res = makeRes();

    createBasicAuth({ user: 'ada', password: 'hunter2' })(makeReq('/', encode('ada', 'wrong')), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('rejects a wrong user', () => {
    const next = vi.fn();
    const res = makeRes();

    createBasicAuth({ user: 'ada', password: 'hunter2' })(makeReq('/', encode('bob', 'hunter2')), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('rejects a password that is a prefix of the real one', () => {
    const next = vi.fn();
    const res = makeRes();

    createBasicAuth({ user: 'ada', password: 'hunter2' })(makeReq('/', encode('ada', 'hunter')), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('accepts correct credentials', () => {
    const next = vi.fn();
    const res = makeRes();

    createBasicAuth({ user: 'ada', password: 'hunter2' })(makeReq('/', encode('ada', 'hunter2')), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeUndefined();
  });

  it('leaves /api/health reachable without credentials', () => {
    const next = vi.fn();
    const res = makeRes();

    createBasicAuth({ user: 'ada', password: 'hunter2' })(makeReq('/api/health'), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeUndefined();
  });

  it('honours a custom publicPaths list', () => {
    const next = vi.fn();
    const res = makeRes();

    createBasicAuth({ user: 'ada', password: 'hunter2', publicPaths: ['/ping'] })(makeReq('/ping'), res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('still protects other paths when publicPaths is customised', () => {
    const next = vi.fn();
    const res = makeRes();

    createBasicAuth({ user: 'ada', password: 'hunter2', publicPaths: ['/ping'] })(makeReq('/api/health'), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
