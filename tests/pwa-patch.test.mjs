import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const sha = (s) => createHash('sha256').update(s).digest('hex');

test('patch installer checks base hashes, backs up, verifies and rolls back without touching protected data', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sibdel-patch-'));
  const patch = path.join(root, 'patch'), project = path.join(root, 'project'), backup = path.join(root, 'backup');
  try {
    await mkdir(path.join(patch, 'scripts'), { recursive: true });
    await mkdir(project);
    const script = path.join(patch, 'scripts/stage11a-patch.mjs');
    await copyFile(new URL('../scripts/stage11a-patch.mjs', import.meta.url), script);
    await writeFile(path.join(project, 'old.txt'), 'before');
    await writeFile(path.join(project, '.env'), 'private untouched');
    await mkdir(path.join(project, 'uploads'));
    await writeFile(path.join(project, 'uploads/photo.txt'), 'photo');
    await writeFile(path.join(patch, 'old.txt'), 'after');
    await writeFile(path.join(patch, 'new.txt'), 'new');
    await writeFile(path.join(patch, 'STAGE11A-FILES.json'), JSON.stringify({ files: [
      { path: 'old.txt', before: sha('before'), after: sha('after') },
      { path: 'new.txt', before: null, after: sha('new') },
    ] }));
    const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.equal(run('check', project).status, 0);
    await writeFile(path.join(project, 'old.txt'), 'local edits');
    assert.equal(run('apply', project, backup).status, 1);
    assert.equal(await readFile(path.join(project, 'old.txt'), 'utf8'), 'local edits');
    await writeFile(path.join(project, 'old.txt'), 'before');
    const applied = run('apply', project, backup);
    assert.equal(applied.status, 0, applied.stderr);
    assert.equal(run('verify', project).status, 0);
    await writeFile(path.join(project, 'old.txt'), 'subsequent edit');
    assert.equal(run('rollback', backup).status, 1);
    assert.equal(await readFile(path.join(project, 'old.txt'), 'utf8'), 'subsequent edit');
    await writeFile(path.join(project, 'old.txt'), 'after');
    // Simulate a partially applied/already-restored new file.
    await rm(path.join(project, 'new.txt'));
    assert.equal(run('rollback', backup).status, 0);
    assert.equal(await readFile(path.join(project, 'old.txt'), 'utf8'), 'before');
    await assert.rejects(readFile(path.join(project, 'new.txt')), { code: 'ENOENT' });
    assert.equal(await readFile(path.join(project, '.env'), 'utf8'), 'private untouched');
    assert.equal(await readFile(path.join(project, 'uploads/photo.txt'), 'utf8'), 'photo');
  } finally { await rm(root, { recursive: true, force: true }); }
});
