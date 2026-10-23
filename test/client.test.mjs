import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createClient, GiteaApiError } from '../lib/client.js';
import { fixture, serve } from './support/server.mjs';

const TOKEN = 'tok-1234567890abcdef';

/** A sleep that records how long it was asked to wait and returns at once. */
function recordingSleep() {
  /** @type {number[]} */
  const waits = [];
  return { waits, sleep: async (/** @type {number} */ ms) => void waits.push(ms) };
}

/**
 * @param {string} url
 * @param {Partial<Parameters<typeof createClient>[0]>} [options]
 */
function clientFor(url, options = {}) {
  const { waits, sleep } = recordingSleep();
  return { waits, client: createClient({ apiBase: `${url}/api/v1`, token: TOKEN, sleep, ...options }) };
}

/** Runs a test body against a scripted server and always closes it. */
async function withServer(/** @type {Parameters<typeof serve>[0]} */ steps, /** @type {(s: Awaited<ReturnType<typeof serve>>) => Promise<void>} */ body) {
  const server = await serve(steps);
  try {
    await body(server);
  } finally {
    await server.close();
  }
}

/** A fetch that answers from a list: an Error is thrown, anything else is returned. */
function scriptedFetch(/** @type {Array<Error | Response>} */ outcomes) {
  let calls = 0;
  const fetch = async () => {
    const outcome = outcomes[Math.min(calls, outcomes.length - 1)];
    calls += 1;
    if (outcome instanceof Error) throw outcome;
    return outcome.clone();
  };
  return { fetch: /** @type {typeof globalThis.fetch} */ (/** @type {unknown} */ (fetch)), calls: () => calls };
}

/**
 * A fetch that never answers but rejects when its request is aborted, as the real one does.
 * A real request holds a socket open, which keeps Node running. AbortSignal.timeout does not
 * (its timer is unref'd), so this fake holds a timer of its own until the request is aborted.
 */
const hangingFetch = /** @type {typeof globalThis.fetch} */ (
  /** @type {unknown} */ (
    (/** @type {unknown} */ _url, /** @type {RequestInit} */ init) =>
      new Promise((_resolve, reject) => {
        const keepAlive = setTimeout(() => {}, 60_000);
        init.signal?.addEventListener('abort', () => {
          clearTimeout(keepAlive);
          reject(init.signal?.reason);
        });
      })
  )
);

function connectionError(/** @type {string} */ code) {
  return Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) });
}

/** True when the text appears in any own property of the error, its body or its cause. */
function leaks(/** @type {unknown} */ error, /** @type {string} */ text) {
  const e = /** @type {any} */ (error);
  return [e.message, e.stack, JSON.stringify(e.body), e.cause?.message, e.path, e.method].some((part) => String(part).includes(text));
}

// --- requests -------------------------------------------------------------

test('every request carries the token header, and a json option is sent as a JSON body', () =>
  withServer([fixture('version'), fixture('created')], async (server) => {
    const { client } = clientFor(server.url);
    assert.deepEqual(await client.request('GET', '/version'), { version: '28.2.0' });
    assert.deepEqual(await client.request('POST', '/repos/o/r/releases', { json: { tag_name: 'v1.0.0' } }), { id: 1 });

    const [get, post] = server.requests;
    assert.equal(get.headers.authorization, `token ${TOKEN}`);
    assert.equal(get.headers.accept, 'application/json');
    assert.equal(post.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(post.body), { tag_name: 'v1.0.0' });
  }));

test('query options are added to the URL', () =>
  withServer([fixture('version')], async (server) => {
    const { client } = clientFor(server.url);
    await client.request('GET', '/issues', { query: { state: 'open', page: 2 } });
    assert.equal(server.requests[0].url, '/api/v1/issues?state=open&page=2');
  }));

test('an empty success body gives null and a non-JSON success body gives its text', () =>
  withServer(
    [(_req, res) => res.writeHead(204).end(), (_req, res) => res.writeHead(200, { 'content-type': 'text/plain' }).end('plain words')],
    async (server) => {
      const { client } = clientFor(server.url);
      assert.equal(await client.request('DELETE', '/x'), null);
      assert.equal(await client.request('GET', '/y'), 'plain words');
    },
  ));

test('a path that is a full URL is refused, so the token cannot be sent to another host', async () => {
  const { client } = clientFor('http://127.0.0.1:1');
  await assert.rejects(client.request('GET', 'https://other.example/x'), /relative to the API base/);
});

test('no module other than lib/client.js uses fetch or undici', () => {
  const network = /\bfetch\s*\(|globalThis\.fetch|from\s+'undici'|import\(\s*'undici'\s*\)/;
  /** @type {string[]} */
  const callers = [];
  const scan = (/** @type {URL} */ dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const next = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) scan(next);
      else if (entry.name.endsWith('.js') && entry.name !== 'client.js' && network.test(readFileSync(next, 'utf8'))) callers.push(entry.name);
    }
  };
  scan(new URL('../lib/', import.meta.url));
  assert.deepEqual(callers, []);
  assert.doesNotMatch(readFileSync(new URL('../index.js', import.meta.url), 'utf8'), network);
});

// --- redirects and timeouts ----------------------------------------------

test('a redirect is not followed and the other host never receives a request', () =>
  withServer([fixture('version')], async (other) => {
    await withServer(
      [(_req, res) => res.writeHead(302, { location: `${other.url}/api/v1/steal` }).end()],
      async (server) => {
        const { client } = clientFor(server.url);
        await assert.rejects(client.request('GET', '/version'), (/** @type {GiteaApiError} */ error) => {
          assert.equal(error.status, 302);
          assert.match(error.message, /redirect/i);
          assert.equal(leaks(error, TOKEN), false);
          return true;
        });
        assert.equal(other.requests.length, 0);
        assert.equal(server.requests.length, 1, 'a redirect is not retried');
      },
    );
  }));

test('a request that times out is retried, then fails with status 0 and the original error as the cause', async () => {
  const { client, waits } = clientFor('http://127.0.0.1:1', { fetch: hangingFetch, timeoutMs: 20 });
  await assert.rejects(client.request('GET', '/version'), (/** @type {GiteaApiError} */ error) => {
    assert.equal(error.status, 0);
    assert.ok(error.cause, 'the cause should be kept');
    return true;
  });
  assert.deepEqual(waits, [500, 1000, 2000]);
});

/**
 * A fetch the test answers by hand. It rejects when its request is aborted, as the real one
 * does, and holds a timer so Node stays running while it waits.
 */
function manualFetch() {
  /** @type {AbortSignal | undefined} */
  let signal;
  /** @type {(response: Response) => void} */
  let answer = () => {};
  const fetch = /** @type {typeof globalThis.fetch} */ (
    /** @type {unknown} */ (
      (/** @type {unknown} */ _url, /** @type {RequestInit} */ init) =>
        new Promise((resolve, reject) => {
          signal = /** @type {AbortSignal} */ (init.signal);
          const keepAlive = setTimeout(() => {}, 60_000);
          answer = (response) => {
            clearTimeout(keepAlive);
            resolve(response);
          };
          signal.addEventListener('abort', () => {
            clearTimeout(keepAlive);
            reject(signal?.reason);
          });
        })
    )
  );
  return { fetch, answer: (/** @type {Response} */ response) => answer(response), aborted: () => signal?.aborted };
}

/** Lets timer ticks pass, longer than the short default limit used below. */
const pause = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('a request can set its own time limit, which replaces the default for that call only', async () => {
  const slow = manualFetch();
  const { client } = clientFor('http://127.0.0.1:1', { fetch: slow.fetch, timeoutMs: 20 });
  const pending = client.request('POST', '/upload', { timeoutMs: 10_000 });
  await pause(100);
  assert.equal(slow.aborted(), false, 'the longer limit is still running');
  slow.answer(new Response('{"ok":true}', { status: 201 }));
  assert.deepEqual(await pending, { ok: true });

  const fast = manualFetch();
  const { client: other } = clientFor('http://127.0.0.1:1', { fetch: fast.fetch, timeoutMs: 20 });
  await assert.rejects(other.request('POST', '/upload'), (/** @type {GiteaApiError} */ error) => error.status === 0);
  assert.equal(fast.aborted(), true, 'without the option the default limit applies');
});

// --- retries ---------------------------------------------------------------

test('GET and PATCH retry a 503 until the server recovers, but POST does not', () =>
  withServer([fixture('unavailable'), fixture('unavailable'), fixture('unavailable'), fixture('version')], async (server) => {
    for (const method of ['GET', 'PATCH']) {
      server.requests.length = 0;
      const { client } = clientFor(server.url);
      assert.deepEqual(await client.request(method, '/version'), { version: '28.2.0' });
      assert.equal(server.requests.length, 4);
    }
    await withServer([fixture('unavailable'), fixture('version')], async (second) => {
      const { client } = clientFor(second.url);
      await assert.rejects(client.request('POST', '/x', { json: {} }), (/** @type {GiteaApiError} */ error) => error.status === 503);
      assert.equal(second.requests.length, 1);
    });
  }));

test('a persistent 500 is tried four times with growing waits, then fails with the status', () =>
  withServer([{ ...fixture('unavailable'), status: 500 }], async (server) => {
    const { client, waits } = clientFor(server.url);
    await assert.rejects(client.request('GET', '/version'), (/** @type {GiteaApiError} */ error) => error.status === 500);
    assert.equal(server.requests.length, 4);
    assert.deepEqual(waits, [500, 1000, 2000]);
  }));

test('POST is retried after a 429 and after a connection error before the request was sent', async () => {
  await withServer([fixture('rate-limited'), fixture('created')], async (server) => {
    const { client } = clientFor(server.url);
    assert.deepEqual(await client.request('POST', '/x', { json: {} }), { id: 1 });
    assert.equal(server.requests.length, 2);
  });

  for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']) {
    const { fetch, calls } = scriptedFetch([connectionError(code), new Response('{"id":1}', { status: 201 })]);
    const { client } = clientFor('http://127.0.0.1:1', { fetch });
    assert.deepEqual(await client.request('POST', '/x', { json: {} }), { id: 1 }, code);
    assert.equal(calls(), 2, code);
  }
});

test('POST is not retried after a timeout or a reset connection, so nothing is created twice', async () => {
  const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
  for (const error of [timeout, connectionError('ECONNRESET')]) {
    const { fetch, calls } = scriptedFetch([error, new Response('{"id":1}', { status: 201 })]);
    const { client } = clientFor('http://127.0.0.1:1', { fetch });
    await assert.rejects(client.request('POST', '/x', { json: {} }), (/** @type {GiteaApiError} */ e) => e.status === 0);
    assert.equal(calls(), 1);
  }
});

test('GET is retried after a reset connection', async () => {
  const { fetch, calls } = scriptedFetch([connectionError('ECONNRESET'), new Response('{"ok":true}', { status: 200 })]);
  const { client } = clientFor('http://127.0.0.1:1', { fetch });
  assert.deepEqual(await client.request('GET', '/x'), { ok: true });
  assert.equal(calls(), 2);
});

test('Retry-After in seconds replaces the backoff wait', () =>
  withServer([fixture('rate-limited'), fixture('version')], async (server) => {
    const { client, waits } = clientFor(server.url);
    await client.request('GET', '/version');
    assert.deepEqual(waits, [2000]);
  }));

test('Retry-After as a date waits until that time', () =>
  withServer(
    [(_req, res) => res.writeHead(429, { 'retry-after': 'Thu, 01 Jan 2026 00:00:03 GMT' }).end(), fixture('version')],
    async (server) => {
      const { client, waits } = clientFor(server.url, { now: () => Date.parse('2026-01-01T00:00:00Z') });
      await client.request('GET', '/version');
      assert.deepEqual(waits, [3000]);
    },
  ));

test('a Retry-After longer than 60 seconds is not waited for', () =>
  withServer([{ ...fixture('rate-limited'), headers: { 'retry-after': '120' } }, fixture('version')], async (server) => {
    const { client, waits } = clientFor(server.url);
    await assert.rejects(client.request('GET', '/version'), (/** @type {GiteaApiError} */ error) => error.status === 429);
    assert.deepEqual(waits, []);
    assert.equal(server.requests.length, 1);
  }));

// --- errors ----------------------------------------------------------------

test('an error response becomes a GiteaApiError with the Gitea message and no query string in the path', () =>
  withServer([fixture('not-found')], async (server) => {
    const { client } = clientFor(server.url);
    await assert.rejects(client.request('GET', '/repos/o/r', { query: { secret: 'x' } }), (/** @type {GiteaApiError} */ error) => {
      assert.ok(error instanceof GiteaApiError);
      assert.equal(error.status, 404);
      assert.equal(error.method, 'GET');
      assert.equal(error.path, '/repos/o/r');
      assert.equal(error.message, "Gitea GET /repos/o/r failed with 404: The target couldn't be found.");
      assert.equal(/** @type {any} */ (error.body).message, "The target couldn't be found.");
      return true;
    });
  }));

test('a plain-text 404 keeps its text in the message', () =>
  withServer([fixture('not-found-text')], async (server) => {
    const { client } = clientFor(server.url);
    await assert.rejects(client.request('GET', '/nope'), (/** @type {GiteaApiError} */ error) => {
      assert.equal(error.body, '404 page not found');
      assert.match(error.message, /failed with 404: 404 page not found/);
      return true;
    });
  }));

test('the token is hidden when the server echoes it back', () =>
  withServer(
    [(_req, res) => res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ message: `bad token ${TOKEN}` }))],
    async (server) => {
      const { client } = clientFor(server.url);
      await assert.rejects(client.request('GET', '/version'), (/** @type {GiteaApiError} */ error) => {
        assert.equal(error.status, 401);
        assert.equal(leaks(error, TOKEN), false);
        assert.match(error.message, /\*\*\*/);
        return true;
      });
    },
  ));

test('a network failure hides the token and URL credentials in the message and the cause', async () => {
  const failure = Object.assign(new TypeError('fetch failed'), {
    cause: new Error(`connect failed for https://user:pw@git.example with ${TOKEN}`),
  });
  const { fetch } = scriptedFetch([failure]);
  const { client } = clientFor('http://127.0.0.1:1', { fetch });
  await assert.rejects(client.request('PUT', '/x'), (/** @type {GiteaApiError} */ error) => {
    assert.equal(error.status, 0);
    assert.match(error.message, /^Gitea PUT \/x failed: /);
    assert.equal(leaks(error, TOKEN), false);
    assert.equal(leaks(error, 'pw'), false);
    assert.ok(error.cause instanceof Error, 'the cause is kept, with its text hidden');
    return true;
  });
});

test('an error body that holds a URL and an @ in different values keeps its message and status', () =>
  withServer(
    [
      (_req, res) =>
        res
          .writeHead(404, { 'content-type': 'application/json' })
          .end(JSON.stringify({ message: 'see http://localhost:3000', contact: { email: 'a@b.example' } })),
    ],
    async (server) => {
      const { client } = clientFor(server.url);
      await assert.rejects(client.request('GET', '/x'), (/** @type {GiteaApiError} */ error) => {
        assert.ok(error instanceof GiteaApiError, `expected GiteaApiError, got ${error}`);
        assert.equal(error.status, 404);
        assert.equal(/** @type {any} */ (error.body).message, 'see http://localhost:3000');
        assert.equal(/** @type {any} */ (error.body).contact.email, 'a@b.example');
        return true;
      });
    },
  ));

test('a URL with credentials inside an error body value is hidden', () =>
  withServer(
    [(_req, res) => res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ message: 'proxy http://user:pw@proxy.example failed' }))],
    async (server) => {
      const { client } = clientFor(server.url);
      await assert.rejects(client.request('POST', '/x', { json: {} }), (/** @type {GiteaApiError} */ error) => {
        assert.equal(leaks(error, 'pw'), false);
        assert.match(error.message, /http:\/\/\*\*\*@proxy\.example/);
        return true;
      });
    },
  ));

/** A response whose body fails to arrive, as when the connection drops midway. */
function brokenBody() {
  return /** @type {Response} */ (
    /** @type {unknown} */ ({
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      text: async () => {
        throw connectionError('ECONNRESET');
      },
    })
  );
}

test('a body that fails to arrive is a network error: a GET is retried and a POST is not', async () => {
  const retried = scriptedFetch([brokenBody(), new Response('{"ok":true}', { status: 200 })]);
  const { client } = clientFor('http://127.0.0.1:1', { fetch: retried.fetch });
  assert.deepEqual(await client.request('GET', '/x'), { ok: true });
  assert.equal(retried.calls(), 2);

  const once = scriptedFetch([brokenBody(), new Response('{"id":1}', { status: 201 })]);
  const { client: poster } = clientFor('http://127.0.0.1:1', { fetch: once.fetch });
  await assert.rejects(poster.request('POST', '/x', { json: {} }), (/** @type {GiteaApiError} */ error) => error.status === 0);
  assert.equal(once.calls(), 1);
});

// --- pagination ------------------------------------------------------------

test('paginate follows the next link through every page and returns all items in order', () =>
  withServer([fixture('page-1'), fixture('page-2'), fixture('page-3')], async (server) => {
    const { client } = clientFor(server.url);
    assert.deepEqual(await client.paginate('/items'), [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
    assert.deepEqual(
      server.requests.map((r) => r.url),
      ['/api/v1/items', '/api/v1/items?page=2', '/api/v1/items?page=3'],
    );
    assert.ok(server.requests.every((r) => r.headers.authorization === `token ${TOKEN}`));
  }));

test('paginate refuses a next link to another origin and does not request it', () =>
  withServer([fixture('version')], async (other) => {
    await withServer(
      [(_req, res) => res.writeHead(200, { link: `<${other.url}/api/v1/items?page=2>; rel="next"` }).end('[{"id":1}]')],
      async (server) => {
        const { client } = clientFor(server.url);
        await assert.rejects(client.paginate('/items'), /another host/);
        assert.equal(other.requests.length, 0);
      },
    );
  }));

test('paginate stops with an error when a next link points back at a page it already read', () =>
  withServer(
    [(req, res) => res.writeHead(200, { link: `<http://${req.headers.host}${req.url}>; rel="next"` }).end('[{"id":1}]')],
    async (server) => {
      const { client } = clientFor(server.url);
      await assert.rejects(client.paginate('/items'), /loop|again/i);
      assert.equal(server.requests.length, 1);
    },
  ));

test('paginate does not treat rel="nextfoo" as the next page', () =>
  withServer([(_req, res) => res.writeHead(200, { link: '<http://localhost/x>; rel="nextfoo"' }).end('[{"id":1}]')], async (server) => {
    const { client } = clientFor(server.url);
    assert.deepEqual(await client.paginate('/items'), [{ id: 1 }]);
  }));

test('a response without a Link header is the last page', () =>
  withServer([(_req, res) => res.writeHead(200).end('[{"id":9}]')], async (server) => {
    const { client } = clientFor(server.url);
    assert.deepEqual(await client.paginate('/items'), [{ id: 9 }]);
  }));

// --- proxy -----------------------------------------------------------------

test('with a proxy, the first request loads undici once and sends the request through its fetch and agent', async () => {
  let loads = 0;
  /** @type {unknown[]} */
  const dispatchers = [];
  class ProxyAgent {
    constructor(/** @type {string} */ url) {
      this.url = url;
    }
  }
  const proxyFetch = async (/** @type {unknown} */ _url, /** @type {any} */ init) => {
    dispatchers.push(init.dispatcher);
    return new Response('{"ok":true}', { status: 200 });
  };
  const { client } = clientFor('http://127.0.0.1:1', {
    proxy: { host: 'proxy.example', port: 3128 },
    loadProxy: async () => (loads++, { fetch: /** @type {any} */ (proxyFetch), ProxyAgent }),
    fetch: /** @type {any} */ (async () => assert.fail('the global fetch must not be used with a proxy')),
  });
  assert.equal(loads, 0, 'creating the client loads nothing');
  await client.request('GET', '/a');
  await client.request('GET', '/b');
  assert.equal(loads, 1);
  assert.ok(dispatchers[0] instanceof ProxyAgent);
  assert.equal(/** @type {ProxyAgent} */ (dispatchers[0]).url, 'http://proxy.example:3128');
});

test('if undici cannot be loaded, the first request fails with EMISSINGPROXYPACKAGE and hides proxy credentials', async () => {
  const { client } = clientFor('http://127.0.0.1:1', {
    proxy: 'http://user:hunter2@proxy.example:3128',
    loadProxy: async () => {
      throw new Error('Cannot find package undici');
    },
  });
  await assert.rejects(client.request('GET', '/a'), (/** @type {any} */ error) => {
    assert.equal(error.code, 'EMISSINGPROXYPACKAGE');
    assert.doesNotMatch(`${error.message} ${error.details}`, /hunter2/);
    return true;
  });
});

test('without a proxy the loader is never called', () =>
  withServer([fixture('version')], async (server) => {
    const { client } = clientFor(server.url, {
      loadProxy: async () => assert.fail('undici must not be loaded without a proxy'),
    });
    await client.request('GET', '/version');
  }));
