// A small stand-in for a Gitea server. It keeps a repository table so tests
// can check what a run created and deleted. Anything it does not know
// answers 404, like Gitea does for an unknown route.
import http from 'node:http';

export async function fakeGitea({ login = 'testing', repos = [], failOn = null, failDelete = false } = {}) {
  const table = new Map(repos.map((r) => [r.name, r]));
  const requests = [];
  const created = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    requests.push({ method: req.method, path: url.pathname, auth: req.headers.authorization });
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const p = url.pathname.replace(/^\/api\/v1/, '');
      if (failOn && p.includes(failOn)) return send(500, { message: 'boom' });
      if (p === '/version') return send(200, { version: '1.99.0' });
      if (p === '/user') return send(200, { id: 7, login, email: 'testing@gitea.test.invalid' });
      if (p === '/user/repos' && req.method === 'GET') return send(200, [...table.values()]);
      if (p === '/user/repos' && req.method === 'POST') {
        const { name } = JSON.parse(body);
        const repo = { name, owner: { login }, created_at: new Date().toISOString() };
        table.set(name, repo);
        created.push(name);
        return send(201, repo);
      }
      const repoPath = /^\/repos\/([^/]+)\/([^/]+)$/.exec(p);
      if (repoPath && req.method === 'DELETE') {
        if (failDelete) return send(500, { message: 'cannot delete' });
        table.delete(repoPath[2]);
        return send(204);
      }
      if (repoPath && req.method === 'GET' && table.has(repoPath[2])) {
        return send(200, { ...table.get(repoPath[2]), permissions: { push: true }, clone_url: `https://gitea.test.invalid/testing/${repoPath[2]}.git` });
      }
      return send(404, { message: 'not found' });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    created,
    repoNames: () => [...table.keys()],
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
