import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const srcRoot = path.join(root, 'src');
const failures = [];

const legacyPortalAllowlist = new Set([
  'src/portal/README.md',
  'src/portal/components/QrCodeImage.tsx',
  'src/portal/components/profile/ProfileSection.tsx',
  'src/portal/pages/ActivateAccountPage.tsx',
  'src/portal/pages/CompleteProfilePage.tsx',
  'src/portal/pages/TenantMoveOutPage.tsx',
  'src/portal/pages/TenantPaymentReturnPage.tsx',
  'src/portal/pages/TenantProfilePortalPage.tsx',
  'src/portal/utils/payableObligations.ts',
]);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['dist', 'node_modules'].includes(entry.name)) return [];
      return walk(fullPath);
    }
    return [fullPath];
  });
}

function rel(file) {
  return path.relative(root, file).replaceAll(path.sep, '/');
}

function isSourceFile(file) {
  return /\.(tsx?|jsx?)$/.test(file);
}

for (const file of walk(path.join(srcRoot, 'portal'))) {
  const relative = rel(file);
  if (!legacyPortalAllowlist.has(relative)) {
    failures.push(`${relative}: src/portal is frozen; new tenant code belongs in src/platforms/tenant or src/domains`);
  }
}

const uiSurfaceRoots = [
  path.join(srcRoot, 'app'),
  path.join(srcRoot, 'platforms'),
  path.join(srcRoot, 'shared', 'ui'),
];

for (const rootDir of uiSurfaceRoots) {
  for (const file of walk(rootDir).filter(isSourceFile)) {
    const source = fs.readFileSync(file, 'utf8');
    const relative = rel(file);
    if (/\bfetch\s*\(/.test(source)) {
      failures.push(`${relative}: direct fetch() is not allowed in UI/platform code; use a domain api module`);
    }
    if (/from ['"]axios['"]/.test(source) || /\baxios\./.test(source)) {
      failures.push(`${relative}: direct axios usage is not allowed in UI/platform code; use infrastructure/api or domain api`);
    }
  }
}

// ── features layer: must use api client, never raw axios or fetch ─────────────
for (const file of walk(path.join(srcRoot, 'features')).filter(isSourceFile)) {
  const source = fs.readFileSync(file, 'utf8');
  const relative = rel(file);
  if (/\bfetch\s*\(/.test(source)) {
    failures.push(`${relative}: direct fetch() is not allowed in features; use api from @lib/api-client`);
  }
  if (/from ['"]axios['"]/.test(source)) {
    failures.push(`${relative}: direct axios import is not allowed in features; use api from @lib/api-client`);
  }
}

// ── portal layer: must use api client, never raw axios or fetch ───────────────
for (const file of walk(path.join(srcRoot, 'portal')).filter(isSourceFile)) {
  if (legacyPortalAllowlist.has(rel(file))) continue;
  const source = fs.readFileSync(file, 'utf8');
  const relative = rel(file);
  if (/\bfetch\s*\(/.test(source)) {
    failures.push(`${relative}: direct fetch() is not allowed in portal; use api from @lib/api-client`);
  }
  if (/from ['"]axios['"]/.test(source)) {
    failures.push(`${relative}: direct axios import is not allowed in portal; use api from @lib/api-client`);
  }
}

// ── context layer: must use api client, never raw axios or fetch ──────────────
for (const file of walk(path.join(srcRoot, 'context')).filter(isSourceFile)) {
  const source = fs.readFileSync(file, 'utf8');
  const relative = rel(file);
  if (/\bfetch\s*\(/.test(source)) {
    failures.push(`${relative}: direct fetch() is not allowed in context; use api from @lib/api-client`);
  }
  if (/from ['"]axios['"]/.test(source)) {
    failures.push(`${relative}: direct axios import is not allowed in context; use api from @lib/api-client`);
  }
}

for (const file of walk(path.join(srcRoot, 'shared')).filter(isSourceFile)) {
  const source = fs.readFileSync(file, 'utf8');
  const relative = rel(file);
  if (/^src\/shared\/ui\/(?:[^/]+\/)?index\.ts$/.test(relative)) continue;
  if (/from ['"]@\/(app|platforms|portal|features|domains|services)\//.test(source)) {
    failures.push(`${relative}: shared code must not import app/platform/portal/feature/domain code`);
  }
}

if (failures.length) {
  console.error(`Architecture boundary check failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Architecture boundary check passed');
