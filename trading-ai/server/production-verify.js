'use strict';

/*
 * YASHWIN AI Trading Assistant
 * Task 20 — Non-Destructive Production Readiness & Verification Script
 *
 * Inspects configuration, canonical database path & integrity, HTTP health/readiness
 * endpoints, PWA static assets, and Android build configuration without modifying
 * or resetting the real production database.
 */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { validateProductionEnvironment, getSafePublicConfig } = require('./config');
const db = require('./database');
const apiServer = require('./api-server');

function httpGet(port, reqPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: reqPath,
        method: 'GET',
        headers
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch (_) {}
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text: raw,
            json
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function runProductionVerification(options = {}) {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevDiagToken = process.env.DIAGNOSTICS_AUTH_TOKEN;
  const tempDiagToken = 'PROD_VERIFY_DIAG_TOKEN_2026_SAFE';

  process.env.NODE_ENV = 'production';
  process.env.DIAGNOSTICS_AUTH_TOKEN = tempDiagToken;

  const envCheck = validateProductionEnvironment(options.env || process.env);
  const safePublicCfg = getSafePublicConfig();
  const dbAudit = db.runDatabaseAuditAndIntegrityCheck();

  const server = apiServer.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  let healthRes;
  let readinessMinimalRes;
  let unauthReadinessAuditRes;
  let unauthDbAuditRes;
  let readinessRes;
  let dbAuditRes;
  let indexHtmlRes;
  let manifestRes;
  let swRes;
  let liveOrderRes;

  try {
    healthRes = await httpGet(port, '/api/health');
    readinessMinimalRes = await httpGet(port, '/api/readiness');
    unauthReadinessAuditRes = await httpGet(port, '/api/readiness/audit');
    unauthDbAuditRes = await httpGet(port, '/api/database/audit');
    readinessRes = await httpGet(port, '/api/readiness/audit', {
      'X-Diagnostics-Token': tempDiagToken
    });
    dbAuditRes = await httpGet(port, '/api/database/audit', {
      'X-Diagnostics-Token': tempDiagToken
    });
    indexHtmlRes = await httpGet(port, '/');
    manifestRes = await httpGet(port, '/manifest.webmanifest');
    swRes = await httpGet(port, '/sw.js');
    liveOrderRes = await httpGet(port, '/api/order/place');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevDiagToken === undefined) delete process.env.DIAGNOSTICS_AUTH_TOKEN;
    else process.env.DIAGNOSTICS_AUTH_TOKEN = prevDiagToken;
  }

  const androidGradlePath = path.resolve(db.PROJECT_ROOT, 'android', 'gradle.properties');
  const androidAppGradlePath = path.resolve(db.PROJECT_ROOT, 'android', 'app', 'build.gradle.kts');
  const androidConfigured =
    fs.existsSync(androidGradlePath) && fs.existsSync(androidAppGradlePath);

  const checks = {
    environmentValid: envCheck.ok === true,
    paperModeEnforced:
      safePublicCfg.trading.mode === 'paper' &&
      safePublicCfg.trading.liveEnabled === false &&
      healthRes.json?.liveTradingEnabled === false,
    zeroLiveOrderEndpoints:
      healthRes.json?.orderEndpoints === 'NONE' && liveOrderRes.status === 404,
    healthEndpointOk:
      healthRes.status === 200 &&
      healthRes.json?.ok === true &&
      !('tables' in (healthRes.json?.database || {})),
    diagnosticsProtectedOk:
      unauthReadinessAuditRes.status === 401 &&
      unauthDbAuditRes.status === 401 &&
      readinessMinimalRes.status === 200 &&
      !('databaseAudit' in (readinessMinimalRes.json || {})),
    readinessEndpointOk:
      readinessRes.status === 200 && readinessRes.json?.liveTradingEnabled === false,
    databaseAuditOk:
      dbAudit.ok === true &&
      dbAudit.healthy === true &&
      dbAudit.schemaVersion === db.LATEST_SCHEMA_VERSION &&
      dbAuditRes.status === 200 &&
      dbAuditRes.json?.ok === true,
    pwaShellServedOk:
      indexHtmlRes.status === 200 &&
      manifestRes.status === 200 &&
      swRes.status === 200 &&
      swRes.headers['service-worker-allowed'] === '/',
    securityHeadersPresent:
      Boolean(healthRes.headers['content-security-policy']) &&
      healthRes.headers['x-content-type-options'] === 'nosniff' &&
      healthRes.headers['x-frame-options'] === 'SAMEORIGIN',
    androidProjectConfigured: androidConfigured
  };

  const allPassed = Object.values(checks).every(Boolean);

  return {
    ok: allPassed,
    verifiedAt: new Date().toISOString(),
    canonicalDatabasePath: 'server/data/yashwin-trading.sqlite',
    activeDatabaseRelativePath: dbAudit.relativePath,
    schemaVersion: dbAudit.schemaVersion,
    tablesCount: dbAudit.tablesCount,
    tradingMode: safePublicCfg.trading.mode,
    liveTradingEnabled: false,
    orderEndpoints: 'NONE',
    checks
  };
}

if (require.main === module) {
  runProductionVerification()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.ok ? 0 : 1;
    })
    .catch((err) => {
      console.error(
        JSON.stringify({
          ok: false,
          code: err.code || 'PRODUCTION_VERIFY_FAILED',
          message: err.message || 'Production verification failed.'
        })
      );
      process.exitCode = 1;
    })
    .finally(() => {
      db.closeDb();
    });
}

module.exports = {
  runProductionVerification
};
