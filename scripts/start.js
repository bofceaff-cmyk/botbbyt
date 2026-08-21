#!/usr/bin/env node
/**
 * Railway / production boot:
 * 1) проверяет обязательные env
 * 2) prisma migrate deploy
 * 3) ensure-schema (догоняет uid/KYC если миграции не все были в образе)
 * 4) запускает сервер
 */
const { spawnSync } = require('child_process');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function fail(msg) {
  console.error('[boot]', msg);
  process.exit(1);
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: process.env,
    cwd: path.join(__dirname, '..'),
    shell: false,
  });
  return res.status == null ? 1 : res.status;
}

const dbUrl = String(process.env.DATABASE_URL || '').trim();
if (!dbUrl) {
  fail(
    'DATABASE_URL пустой.\n' +
    'На Railway: Variables → Add Variable Reference → Postgres.DATABASE_URL\n' +
    'Не создавайте DATABASE_URL пустой строкой.'
  );
}

if (!process.env.BOT_TOKEN) {
  console.warn('[boot] BOT_TOKEN не задан — бот не запустится');
}

console.log('[boot] DATABASE_URL ok, running migrations…');
const migrateCode = run('npx', ['prisma', 'migrate', 'deploy']);
if (migrateCode !== 0) {
  console.warn('[boot] migrate deploy вернул код', migrateCode, '— пробуем ensure-schema');
}

console.log('[boot] ensuring schema…');
const ensureCode = run(process.execPath, [path.join(__dirname, 'ensure-schema.js')]);
if (ensureCode !== 0) {
  fail('ensure-schema завершился с ошибкой');
}

console.log('[boot] starting server…');
process.exit(run(process.execPath, [path.join(__dirname, '..', 'src', 'index.js')]));
