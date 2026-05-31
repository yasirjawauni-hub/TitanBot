import { spawnSync } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { logger } from '../src/utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function coerce(val) {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (!isNaN(val)) return Number(val);
  return val;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      let [key, value] = token.slice(2).split('=');
      if (value === undefined) {
        const next = argv[i + 1];
        if (!next || next.startsWith('-')) {
          value = true;
        } else {
          value = next;
          i++;
        }
      }
      args[key] = coerce(value);
    } else if (token.startsWith('-')) {
      token.slice(1).split('').forEach(f => args[f] = true);
    }
  }
  return args;
}

function ensureCommand(command) {
  const result = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    stdio: 'pipe',
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) {
    throw new Error(`${command} is required but not found in PATH.`);
  }
}

async function resolveLatestBackup(backupDir) {
  const entries = await readdir(backupDir, { withFileTypes: true });
  const dumpFiles = entries.filter(e => e.isFile() && e.name.endsWith('.dump'));
  if (dumpFiles.length === 0) {
    throw new Error(`No .dump backup files found in ${backupDir}`);
  }
  const withStats = await Promise.all(
    dumpFiles.map(async f => ({
      name: f.name,
      mtime: (await stat(path.join(backupDir, f.name))).mtime
    }))
  );
  withStats.sort((a, b) => b.mtime - a.mtime);
  return path.join(backupDir, withStats[0].name);
}

function runCommand(command, args, dryRun = false) {
  if (dryRun) {
    logger.info(`[dry-run] ${command} ${args.join(' ')}`);
    return;
  }
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: 'pipe',
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed (exit ${result.status}): ${result.stderr || result.stdout}`);
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const backupDir = path.resolve(args['backup-dir'] || process.env.BACKUP_DIR || path.join(process.cwd(), 'backups'));
  const targetUrl = args['target-url'] || process.env.POSTGRES_RESTORE_URL || process.env.POSTGRES_URL;
  const dryRun = args['dry-run'] === true;

  if (!targetUrl) throw new Error('Missing target database URL. Set POSTGRES_RESTORE_URL or POSTGRES_URL.');
  if (!args.confirm) throw new Error('Restore requires explicit confirmation. Re-run with --confirm.');

  ensureCommand('pg_restore');
  ensureCommand('psql');

  const inputPath = args.input ? path.resolve(args.input) : await resolveLatestBackup(backupDir);
  const dropSchema = args['drop-schema'] === true;

  logger.warn('Starting database restore', { event: 'restore.start', inputPath, targetUrl, dropSchema, dryRun });

  if (dropSchema) {
    runCommand('psql', [
      '--dbname', targetUrl,
      '-v', 'ON_ERROR_STOP=1',
      '-c', 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'
    ], dryRun);
  }

  runCommand('pg_restore', [
    '--clean', '--if-exists', '--no-owner', '--no-privileges',
    '--dbname', targetUrl, inputPath
  ], dryRun);

  logger.info('Database restore completed', { event: 'restore.completed', inputPath, targetUrl, dryRun });
}

run().catch(error => {
  logger.error('Restore command failed', { event: 'restore.failed', error: error.message });
  process.exit(1);
});
