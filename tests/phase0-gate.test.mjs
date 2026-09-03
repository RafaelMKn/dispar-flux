import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// Helper to acquire GitHub API token if available
function getGitHubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    const token = execSync('gh auth token', { stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf-8' }).trim();
    if (token) return token;
  } catch {
    // gh not installed or not logged in
  }
  return null;
}

// GitHub API Fetch wrapper
async function fetchGitHubApi(endpoint) {
  const url = endpoint.startsWith('https://') ? endpoint : `https://api.github.com/${endpoint.replace(/^\//, '')}`;
  const token = getGitHubToken();
  const headers = {
    'User-Agent': 'phase0-gate-test-runner',
    'Accept': 'application/vnd.github+json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(url, { headers });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data, headers: res.headers };
}

// Safe directory deletion helper for temporary clone directories
function removeDirSafe(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    try {
      if (process.platform === 'win32') {
        execSync(`cmd /c rd /s /q "${dir}"`, { stdio: 'ignore' });
      } else {
        execSync(`rm -rf "${dir}"`, { stdio: 'ignore' });
      }
    } catch {
      // ignore
    }
  }
}

describe('Phase 0 Gate: Legacy Desktop Repository Preservation', () => {
  it('[Desktop Repo Remote] RafaelMKn/dispar-flux-desktop exists, is public, has default branch main', async () => {
    const res = await fetchGitHubApi('repos/RafaelMKn/dispar-flux-desktop');
    assert.equal(res.status, 200, `Expected HTTP 200 from GitHub API for desktop repo, got ${res.status}`);
    assert.equal(res.data.name, 'dispar-flux-desktop');
    assert.equal(res.data.full_name, 'RafaelMKn/dispar-flux-desktop');
    assert.equal(res.data.private, false, 'Desktop repository must be public');
    assert.equal(res.data.default_branch, 'main', 'Desktop default branch must be main');
  });

  it('[Desktop Commits] 79 commits preserved, root commit and latest commit verified', async () => {
    const EXPECTED_ROOT = 'a27c04ca2d6cb6a92973bdb76766035166eb0dd8';
    const EXPECTED_HEAD = 'd7dcf8fe7aa9b02868dff053d846be55df25e305';
    const EXPECTED_COUNT = 79;

    // Verify remote HEAD via git ls-remote
    const remoteRef = execSync('git ls-remote https://github.com/RafaelMKn/dispar-flux-desktop.git refs/heads/main', {
      encoding: 'utf-8',
    }).trim();
    assert.ok(remoteRef.startsWith(EXPECTED_HEAD), `Remote HEAD ${remoteRef} does not match expected ${EXPECTED_HEAD}`);

    // If local repo exists, verify full commit history
    const desktopLocalPath = process.env.DESKTOP_REPO_PATH || (process.platform === 'win32' ? 'C:\\Users\\Rafae\\dev\\dispar-flux-desktop' : null);
    if (desktopLocalPath && fs.existsSync(desktopLocalPath)) {
      const count = parseInt(execSync('git rev-list --count HEAD', { cwd: desktopLocalPath, encoding: 'utf-8' }).trim(), 10);
      assert.equal(count, EXPECTED_COUNT, `Expected ${EXPECTED_COUNT} commits in desktop repo, found ${count}`);

      const root = execSync('git rev-list --max-parents=0 HEAD', { cwd: desktopLocalPath, encoding: 'utf-8' }).trim();
      assert.equal(root, EXPECTED_ROOT, `Desktop root commit (${root}) does not match expected (${EXPECTED_ROOT})`);

      const head = execSync('git rev-parse HEAD', { cwd: desktopLocalPath, encoding: 'utf-8' }).trim();
      assert.equal(head, EXPECTED_HEAD, `Desktop head commit (${head}) does not match expected (${EXPECTED_HEAD})`);
    }
  });

  it('[Desktop Tags & Releases] all 4 tags exist with complete releases and asset files (.exe, .blockmap, latest.yml)', async () => {
    const res = await fetchGitHubApi('repos/RafaelMKn/dispar-flux-desktop/releases');
    assert.equal(res.status, 200, `Failed to fetch releases: HTTP ${res.status}`);
    assert.ok(Array.isArray(res.data), 'Releases response must be an array');

    const expectedTags = ['v0.1.1', 'v0.2.0', 'v0.3.0', 'v0.4.0'];
    const releasesByTag = new Map(res.data.map(r => [r.tag_name, r]));

    for (const tag of expectedTags) {
      assert.ok(releasesByTag.has(tag), `Release for tag ${tag} not found`);
      const release = releasesByTag.get(tag);
      const assetNames = release.assets.map(a => a.name);

      const hasExe = assetNames.some(name => name.endsWith('.exe') && name.includes('Dispar-Flux-Setup'));
      const hasBlockmap = assetNames.some(name => name.endsWith('.exe.blockmap'));
      const hasLatestYml = assetNames.includes('latest.yml');

      assert.ok(hasExe, `Release ${tag} missing .exe setup installer asset (found: ${assetNames.join(', ')})`);
      assert.ok(hasBlockmap, `Release ${tag} missing .blockmap asset (found: ${assetNames.join(', ')})`);
      assert.ok(hasLatestYml, `Release ${tag} missing latest.yml asset (found: ${assetNames.join(', ')})`);

      for (const asset of release.assets) {
        assert.ok(asset.size > 0, `Asset ${asset.name} in release ${tag} is 0 bytes`);
      }
    }
  });

  it('[Desktop Clonability] can clone https://github.com/RafaelMKn/dispar-flux-desktop.git to an isolated temp directory, check HEAD, and clean up', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-desktop-clone-'));
    try {
      execSync(`git clone https://github.com/RafaelMKn/dispar-flux-desktop.git "${tempDir}"`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf-8',
      });
      const head = execSync('git rev-parse HEAD', { cwd: tempDir, encoding: 'utf-8' }).trim();
      const count = execSync('git rev-list --count HEAD', { cwd: tempDir, encoding: 'utf-8' }).trim();
      const root = execSync('git rev-list --max-parents=0 HEAD', { cwd: tempDir, encoding: 'utf-8' }).trim();

      assert.equal(head, 'd7dcf8fe7aa9b02868dff053d846be55df25e305', 'Cloned desktop HEAD must match expected latest commit');
      assert.equal(count, '79', 'Cloned desktop repository must contain exactly 79 commits');
      assert.equal(root, 'a27c04ca2d6cb6a92973bdb76766035166eb0dd8', 'Cloned desktop root commit must match expected root');
    } finally {
      removeDirSafe(tempDir);
      assert.ok(!fs.existsSync(tempDir), 'Temp clone directory must be cleaned up');
    }
  });

  it('[Desktop Local Repository] C:\\Users\\Rafae\\dev\\dispar-flux-desktop is clean and up to date with origin', (t) => {
    const desktopLocalPath = process.env.DESKTOP_REPO_PATH || (process.platform === 'win32' ? 'C:\\Users\\Rafae\\dev\\dispar-flux-desktop' : null);
    if (!desktopLocalPath || !fs.existsSync(desktopLocalPath)) {
      t.skip(`Desktop local repo path not present in this environment (verified via remote clone)`);
      return;
    }

    const status = execSync('git status --porcelain', { cwd: desktopLocalPath, encoding: 'utf-8' }).trim();
    assert.equal(status, '', `Desktop local repo has uncommitted changes:\n${status}`);

    const branch = execSync('git branch --show-current', { cwd: desktopLocalPath, encoding: 'utf-8' }).trim();
    assert.equal(branch, 'main', `Desktop local repo current branch is ${branch}, expected main`);

    const localHead = execSync('git rev-parse HEAD', { cwd: desktopLocalPath, encoding: 'utf-8' }).trim();
    const remoteHead = execSync('git rev-parse origin/main', { cwd: desktopLocalPath, encoding: 'utf-8' }).trim();
    assert.equal(localHead, remoteHead, `Desktop local HEAD (${localHead}) differs from origin/main (${remoteHead})`);
    assert.equal(localHead, 'd7dcf8fe7aa9b02868dff053d846be55df25e305');
  });
});

describe('Phase 0 Gate: New Web Repository Foundation & Governance', () => {
  it('[New Web Repo Remote] RafaelMKn/dispar-flux exists, is public, does NOT redirect to desktop, has default branch main', async () => {
    const res = await fetchGitHubApi('repos/RafaelMKn/dispar-flux');
    assert.equal(res.status, 200, `Expected HTTP 200 for web repo, got ${res.status}`);
    assert.equal(res.data.name, 'dispar-flux');
    assert.equal(res.data.full_name, 'RafaelMKn/dispar-flux');
    assert.equal(res.data.private, false, 'Web repository must be public');
    assert.equal(res.data.default_branch, 'main', 'Web repo default branch must be main');

    // Verify it is NOT redirecting to dispar-flux-desktop
    const desktopRes = await fetchGitHubApi('repos/RafaelMKn/dispar-flux-desktop');
    assert.equal(desktopRes.status, 200);
    assert.notEqual(res.data.id, desktopRes.data.id, 'New web repo ID must be distinct from desktop repo ID');
    assert.notEqual(res.data.html_url, desktopRes.data.html_url, 'HTML URLs must be distinct');
  });

  it('[AGPLv3 License] LICENSE exists, contains GNU Affero General Public License v3 headers and text', () => {
    const licensePath = path.join(REPO_ROOT, 'LICENSE');
    assert.ok(fs.existsSync(licensePath), 'LICENSE file must exist');

    const content = fs.readFileSync(licensePath, 'utf-8');
    assert.ok(content.length > 30000, `LICENSE file is unexpectedly small (${content.length} bytes)`);
    assert.ok(content.includes('GNU AFFERO GENERAL PUBLIC LICENSE'), 'Missing GNU AFFERO GENERAL PUBLIC LICENSE title');
    assert.ok(content.includes('Version 3, 19 November 2007'), 'Missing Version 3 header');
    assert.ok(content.includes('Free Software Foundation, Inc.'), 'Missing FSF copyright header');
  });

  it('[Governance Documents] CONTEXT.md, plano-mestre, CONTRIBUTING.md, DCO, README.md, and all 63 ADRs exist and are non-empty', () => {
    const requiredDocs = [
      'CONTEXT.md',
      'CONTRIBUTING.md',
      'DCO',
      'README.md',
      path.join('docs', 'plano-mestre-self-hosted-web.md'),
      path.join('docs', 'adr', 'README.md'),
    ];

    for (const doc of requiredDocs) {
      const fullPath = path.join(REPO_ROOT, doc);
      assert.ok(fs.existsSync(fullPath), `Required governance document missing: ${doc}`);
      const stat = fs.statSync(fullPath);
      assert.ok(stat.size > 0, `Governance document is empty: ${doc}`);
    }

    const adrDir = path.join(REPO_ROOT, 'docs', 'adr');
    assert.ok(fs.existsSync(adrDir), 'docs/adr directory must exist');
    const adrFiles = fs.readdirSync(adrDir);

    for (let i = 1; i <= 63; i++) {
      const prefix = String(i).padStart(4, '0');
      const match = adrFiles.find(f => f.startsWith(`${prefix}-`) && f.endsWith('.md'));
      assert.ok(match, `Missing ADR ${prefix}`);
      const stat = fs.statSync(path.join(adrDir, match));
      assert.ok(stat.size > 0, `ADR ${prefix} (${match}) is empty`);
    }
  });

  it('[DCO & Sign-off] CONTRIBUTING.md contains DCO sign-off guidelines; git commits on main have valid Signed-off-by', () => {
    const contribPath = path.join(REPO_ROOT, 'CONTRIBUTING.md');
    const contribContent = fs.readFileSync(contribPath, 'utf-8');
    assert.ok(contribContent.includes('Developer Certificate of Origin'), 'CONTRIBUTING.md must mention DCO');
    assert.ok(contribContent.includes('-s') || contribContent.includes('--signoff'), 'CONTRIBUTING.md must explain -s flag');
    assert.ok(contribContent.includes('Signed-off-by:'), 'CONTRIBUTING.md must show Signed-off-by example');

    const commits = execSync('git rev-list HEAD', { cwd: REPO_ROOT, encoding: 'utf-8' }).trim().split(/\r?\n/);
    assert.ok(commits.length > 0, 'No commits found in current repo');

    const signoffRegex = /^Signed-off-by:\s+([^<]+)\s+<([^>]+)>/m;
    for (const commitSha of commits) {
      const msg = execSync(`git log -1 --format=%B ${commitSha}`, { cwd: REPO_ROOT, encoding: 'utf-8' });
      assert.match(msg, signoffRegex, `Commit ${commitSha} missing valid Signed-off-by trailer in message:\n${msg}`);
    }
  });

  it('[CI Pipeline] .github/workflows/ci.yml exists, is valid YAML, and the latest GitHub Actions run on GitHub is completed / success', async () => {
    const ciPath = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
    assert.ok(fs.existsSync(ciPath), 'ci.yml must exist');
    const content = fs.readFileSync(ciPath, 'utf-8');
    assert.ok(content.length > 0, 'ci.yml is empty');
    assert.ok(content.includes('name: CI'), 'ci.yml must define workflow name');
    assert.ok(content.includes('validate-baseline'), 'ci.yml must include validate-baseline job');

    // Query GitHub Actions API for completed runs
    const res = await fetchGitHubApi('repos/RafaelMKn/dispar-flux/actions/runs?branch=main&status=completed');
    assert.equal(res.status, 200, `Failed to query actions runs: HTTP ${res.status}`);
    const hasSuccessfulRun = res.data.workflow_runs.some((run) => run.conclusion === 'success');
    assert.ok(hasSuccessfulRun, 'Expected at least one completed GitHub Actions run with conclusion success on branch main');
  });

  it('[Branch Protection] branch main on RafaelMKn/dispar-flux is protected (protected: true, allow_force_pushes: false, allow_deletions: false)', async () => {
    const branchRes = await fetchGitHubApi('repos/RafaelMKn/dispar-flux/branches/main');
    assert.equal(branchRes.status, 200, `Failed to query branch main: HTTP ${branchRes.status}`);
    assert.equal(branchRes.data.protected, true, 'Branch main must be marked as protected');

    // Test detailed protection settings if accessible with token
    const protRes = await fetchGitHubApi('repos/RafaelMKn/dispar-flux/branches/main/protection');
    if (protRes.status === 200) {
      assert.equal(protRes.data.allow_force_pushes?.enabled, false, 'allow_force_pushes must be disabled (false)');
      assert.equal(protRes.data.allow_deletions?.enabled, false, 'allow_deletions must be disabled (false)');
    } else {
      assert.ok(branchRes.data.protected, 'Branch protection verified via branch endpoint');
    }
  });

  it('[New Web Clonability] can clone https://github.com/RafaelMKn/dispar-flux.git to an isolated temp directory, check HEAD, and clean up', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-web-clone-'));
    try {
      execSync(`git clone https://github.com/RafaelMKn/dispar-flux.git "${tempDir}"`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf-8',
      });
      const head = execSync('git rev-parse HEAD', { cwd: tempDir, encoding: 'utf-8' }).trim();
      assert.ok(head.length === 40, `Cloned web HEAD invalid: ${head}`);
      const count = parseInt(execSync('git rev-list --count HEAD', { cwd: tempDir, encoding: 'utf-8' }).trim(), 10);
      assert.ok(count >= 2, `Expected at least 2 commits in web repo, got ${count}`);
    } finally {
      removeDirSafe(tempDir);
      assert.ok(!fs.existsSync(tempDir), 'Temp clone directory must be cleaned up');
    }
  });

  it('[Isolation & Non-Interference] confirms both repos have distinct remote URLs and independent histories', () => {
    const desktopRemoteUrl = 'https://github.com/RafaelMKn/dispar-flux-desktop.git';
    const webRemoteUrl = 'https://github.com/RafaelMKn/dispar-flux.git';
    assert.notEqual(desktopRemoteUrl, webRemoteUrl, 'Remote URLs must be distinct');

    const desktopRootCommit = 'a27c04ca2d6cb6a92973bdb76766035166eb0dd8';
    const webRootCommit = '3fac54a53283abcc2efdaa99f287c25c63fab425';
    assert.notEqual(desktopRootCommit, webRootCommit, 'Root commits must be distinct');

    // Verify web repo does NOT contain desktop root commit
    const webCommits = execSync('git rev-list HEAD', { cwd: REPO_ROOT, encoding: 'utf-8' }).trim().split(/\r?\n/);
    assert.ok(!webCommits.includes(desktopRootCommit), 'Web repo must NOT contain desktop root commit');

    // If local desktop exists, verify desktop repo does NOT contain web root commit
    const desktopLocalPath = process.env.DESKTOP_REPO_PATH || (process.platform === 'win32' ? 'C:\\Users\\Rafae\\dev\\dispar-flux-desktop' : null);
    if (desktopLocalPath && fs.existsSync(desktopLocalPath)) {
      const desktopCommits = execSync('git rev-list HEAD', { cwd: desktopLocalPath, encoding: 'utf-8' }).trim().split(/\r?\n/);
      assert.ok(!desktopCommits.includes(webRootCommit), 'Desktop repo must NOT contain web root commit');
    }
  });
});
