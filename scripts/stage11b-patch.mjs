// Run from the extracted patch; never connects to a database or remote host.
import { readFile, writeFile, mkdir, copyFile, unlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const patchRoot = fileURLToPath(new URL('..', import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const usage = 'Usage: node scripts/stage11b-patch.mjs check|verify PROJECT\n       node scripts/stage11b-patch.mjs apply PROJECT NEW_BACKUP_DIRECTORY\n       node scripts/stage11b-patch.mjs rollback BACKUP_DIRECTORY';
const [action, location, backupArg] = process.argv.slice(2);

function safeRelative(name) {
  if (typeof name !== 'string' || !name || path.isAbsolute(name)
    || name.includes('\\') || name.split('/').some((part) => !part || part === '.' || part === '..'
      || ['.git', '.env', 'node_modules', 'uploads'].includes(part))) throw Error('Unsafe patch path');
  return name;
}
async function checkedPath(root, relative) {
  const parts = safeRelative(relative).split('/');
  let full = root;
  for (const part of parts) {
    full = path.join(full, part);
    try {
      if ((await lstat(full)).isSymbolicLink()) throw Error(`Symbolic link is not allowed: ${relative}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return full;
}
async function currentHash(root, relative) {
  const full = await checkedPath(root, relative);
  try { return hash(await readFile(full)); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function validate(root, entries, side) {
  const mismatches = [];
  for (const entry of entries) {
    if (await currentHash(root, entry.path) !== entry[side]) mismatches.push(entry.path);
  }
  if (mismatches.length) throw Error(`Files do not match the ${side} version; nothing was written:\n${mismatches.join('\n')}`);
}
async function copyInto(sourceRoot, destinationRoot, relative) {
  const source = await checkedPath(sourceRoot, relative);
  const destination = await checkedPath(destinationRoot, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}
try {
  if (!location || !['check', 'verify', 'apply', 'rollback'].includes(action)) throw Error(usage);
  if (action === 'rollback') {
    const backupRoot = path.resolve(location);
    const metadata = JSON.parse(await readFile(path.join(backupRoot, 'metadata.json'), 'utf8'));
    const targetRoot = metadata.target;
    if (!path.isAbsolute(targetRoot) || !Array.isArray(metadata.files)) throw Error('Invalid backup metadata');
    // A failed/partial apply is also recoverable. Already-original files are
    // skipped; any subsequent edits still stop rollback before its first write.
    const restore = [];
    for (const entry of metadata.files) {
      const current = await currentHash(targetRoot, entry.path);
      if (current === entry.before) continue;
      if (current !== entry.after) throw Error(`File changed after patch: ${entry.path}; nothing was written`);
      restore.push(entry);
    }
    // Validate every saved original before restoring any files.
    await validate(path.join(backupRoot, 'files'), metadata.files.filter((entry) => entry.before !== null), 'before');
    for (const entry of restore) {
      if (entry.before === null) await unlink(await checkedPath(targetRoot, entry.path));
      else await copyInto(path.join(backupRoot, 'files'), targetRoot, entry.path);
    }
    console.log('Code restored. No database, .env or uploads were changed. Verify the restored 11A worker and retain the applied migration file as documented.');
  } else {
    const targetRoot = path.resolve(location);
    if (!(await lstat(targetRoot)).isDirectory() || (await lstat(targetRoot)).isSymbolicLink()) throw Error('Project must be a real directory');
    const manifestBytes = await readFile(path.join(patchRoot, 'STAGE11B-FILES.json'));
    const manifest = JSON.parse(manifestBytes);
    const entries = [...manifest.files, { path: 'STAGE11B-FILES.json', before: null, after: hash(manifestBytes) }];
    await validate(patchRoot, entries, 'after');
    await validate(targetRoot, entries, action === 'verify' ? 'after' : 'before');
    if (action === 'apply') {
      if (!backupArg) throw Error(usage);
      const backupRoot = path.resolve(backupArg);
      for (const root of [targetRoot, patchRoot]) {
        if (backupRoot === root || backupRoot.startsWith(root + path.sep)) throw Error('Backup must be outside project and patch directories');
      }
      await mkdir(backupRoot, { mode: 0o700 }); // Must be a new, unused directory.
      for (const entry of entries) {
        if (entry.before !== null) await copyInto(targetRoot, path.join(backupRoot, 'files'), entry.path);
      }
      await writeFile(path.join(backupRoot, 'metadata.json'), JSON.stringify({ target: targetRoot, files: entries }, null, 2), { flag: 'wx' });
      for (const entry of entries) await copyInto(patchRoot, targetRoot, entry.path);
      await validate(targetRoot, entries, 'after');
      console.log(`Applied ${entries.length} files. Backup: ${backupRoot}`);
    } else console.log(`${action}: ${entries.length} files match. No files were changed.`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
