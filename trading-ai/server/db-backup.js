'use strict';

/*
 * YASHWIN AI Trading Assistant
 * Task 20 — Safe SQLite Database Backup & Integrity CLI
 *
 * Uses SQLite's atomic `VACUUM INTO` via server/database.js so that
 * active WAL frames are safely included without copying raw `.sqlite` files
 * mid-transaction and without modifying or resetting production data.
 */

const path = require('node:path');
const db = require('./database');

function runCli(argv = process.argv.slice(2)) {
  const isAuditOnly = argv.includes('--audit') || argv.includes('--check');
  const restoreIndex = argv.indexOf('--restore');

  if (restoreIndex !== -1) {
    const backupSource = argv[restoreIndex + 1];
    const restoreTarget = argv[restoreIndex + 2];
    const result = db.restoreDatabaseFromBackup(backupSource, restoreTarget);
    console.log(
      JSON.stringify(
        {
          ok: result.ok,
          relativeRestoredPath: result.relativeRestoredPath,
          sizeBytes: result.sizeBytes,
          integrityCheck: result.integrityCheck,
          schemaVersion: result.schemaVersion,
          tablesCount: result.tablesCount,
          restoredAt: result.restoredAt
        },
        null,
        2
      )
    );
    process.exitCode = result.ok ? 0 : 1;
    return result;
  }

  if (isAuditOnly) {
    const report = db.runDatabaseAuditAndIntegrityCheck();
    console.log(
      JSON.stringify(
        {
          ok: report.ok,
          healthy: report.healthy,
          databaseFile: report.databaseFile,
          relativePath: report.relativePath,
          schemaVersion: report.schemaVersion,
          latestExpectedSchemaVersion: report.latestExpectedSchemaVersion,
          integrityCheck: report.integrityCheck,
          tablesCount: report.tablesCount,
          invariants: report.invariants
        },
        null,
        2
      )
    );
    process.exitCode = report.ok ? 0 : 1;
    return report;
  }

  const customDestArg = argv.find((arg) => !arg.startsWith('--'));
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultDest = path.resolve(
    db.PROJECT_ROOT,
    'server',
    'data',
    'backups',
    `yashwin-trading-backup-${timestamp}.sqlite`
  );
  const destination = customDestArg || defaultDest;

  const result = db.backupDatabase(destination);
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        relativeBackupPath: result.relativeBackupPath,
        sizeBytes: result.sizeBytes,
        integrityCheck: result.integrityCheck,
        schemaVersion: result.schemaVersion,
        tablesCount: result.tablesCount,
        createdAt: result.createdAt
      },
      null,
      2
    )
  );
  process.exitCode = result.ok ? 0 : 1;
  return result;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(
      JSON.stringify({
        ok: false,
        code: error.code || 'DB_BACKUP_FAILED',
        message: error.message || 'Database backup failed.'
      })
    );
    process.exitCode = 1;
  } finally {
    db.closeDb();
  }
}

module.exports = { runCli };
