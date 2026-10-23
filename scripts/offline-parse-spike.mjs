// Checks 8 and 11 of issue #3. Needs no network and no token.
//
// Check 8: does the issue-parser `github` preset read Gitea references?
// Check 11: does the repository URL parsing used by @semantic-release/github
// 12.0.10 (MIT, copied below) handle the URL forms a Gitea server uses?
//
// The host in every input is the placeholder gitea.example.
import { pathToFileURL } from 'node:url';
import issueParser from 'issue-parser';

const HOST = 'https://gitea.example';

// From @semantic-release/github 12.0.10, lib/parse-github-url.js.
function parseGitHubUrl(repositoryUrl) {
  const [match, auth, host, path] =
    /^(?!.+:\/\/)(?:(?<auth>.*)@)?(?<host>.*?):(?<path>.*)$/.exec(repositoryUrl) || [];
  try {
    const [, owner, repo] = /^\/(?<owner>[^/]+)?\/?(?<repo>.+?)(?:\.git)?$/.exec(
      new URL(match ? `ssh://${auth ? `${auth}@` : ''}${host}/${path}` : repositoryUrl).pathname,
    );
    return { owner, repo };
  } catch {
    return {};
  }
}

const REPOSITORY_URLS = [
  'https://gitea.example/owner/repo.git',
  'https://gitea.example/owner/repo',
  'git@gitea.example:owner/repo.git',
  'ssh://git@gitea.example:2222/owner/repo.git',
  'https://gitea.example/gitea/owner/repo.git',
  'git@gitea.example:gitea/owner/repo.git',
];
const EXPECTED = { owner: 'owner', repo: 'repo' };

export function checkRepositoryUrls() {
  return REPOSITORY_URLS.map((input) => {
    const parsed = parseGitHubUrl(input);
    const correct = parsed.owner === EXPECTED.owner && parsed.repo === EXPECTED.repo;
    return { input, parsed, expected: EXPECTED, correct };
  });
}

const REFERENCES = [
  'Closes #12',
  'Closes owner/repo#12',
  'Closes https://gitea.example/owner/repo/issues/12',
  'Closes https://gitea.example/owner/repo/pulls/12',
  'See https://gitea.example/owner/repo/pulls/12',
  'See #12 and #13',
  'Merge pull request #7 from owner/branch',
  'fix(api): handle empty list (#9)',
];

export function checkIssueReferences() {
  const parser = issueParser('github', { hosts: [HOST] });
  return REFERENCES.map((input) => {
    const { actions, refs, mentions } = parser(input);
    return { input, parsed: { actions, refs, mentions } };
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = [
    { check: 8, ok: true, observed: checkIssueReferences() },
    { check: 11, ok: true, observed: checkRepositoryUrls() },
  ];
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}
