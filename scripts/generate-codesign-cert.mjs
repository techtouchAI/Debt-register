#!/usr/bin/env node
/**
 * توليد شهادة توقيع ذاتية (self-signed) لتوقيع حزم ويندوز من إلكترون.
 *
 * الاستخدام:
 *   npm run certs:generate                  # كلمة المرور الافتراضية techtouch7
 *   CERT_PASSWORD=secret npm run certs:generate
 *
 * المخرجات داخل scripts/certs/:
 *   OfficeManager-CodeSign.pfx      ← الحزمة النهائية (PKCS#12) التي يشير إليها WIN_CSC_LINK
 *   OfficeManager-CodeSign.pfx.b64  ← البصمة Base64 لسطر واحد (لصقها في GitHub secret)
 *   codesign.crt / codesign.key     ← الشهادة والمفتاح للمراجعة (لا ترفعهما)
 *   openssl.cnf                     ← ملف إعداد OpenSSL المستخدم
 *
 * ملاحظات هامة:
 *   - هذه شهادة ذاتية للاختبار والتوزيع الداخلي؛ لن تتجنب تحذير SmartScreen
 *     فوراً حتى يقوم عدد كافٍ من المستخدمين بتشغيل الملفات الموقعة (اكتساب سمعة).
 *   - لتوزيع عام موثوق يلزم شهادة EV/OV Code Signing من CA معتمد.
 *   - لا تُدخل ملف .pfx أو .key في git.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const certDir = join(repoRoot, 'scripts', 'certs');
mkdirSync(certDir, { recursive: true });

const password = process.env.CERT_PASSWORD || 'techtouch7';
const pfxPath = join(certDir, 'OfficeManager-CodeSign.pfx');
const pfxB64Path = join(certDir, 'OfficeManager-CodeSign.pfx.b64');
const keyPath = join(certDir, 'codesign.key');
const crtPath = join(certDir, 'codesign.crt');
const cnfPath = join(certDir, 'openssl.cnf');

const opensslCnf = `[ req ]
default_bits       = 4096
prompt             = no
default_md         = sha256
distinguished_name = dn
req_extensions     = v3_req

[ dn ]
C            = SA
ST           = Riyadh
L            = Riyadh
O            = TechTouch AI
OU           = Software Development
CN           = TechTouch AI
emailAddress = support@techtouch.ai

[ v3_req ]
basicConstraints     = critical, CA:FALSE
keyUsage             = critical, digitalSignature, keyEncipherment
extendedKeyUsage     = critical, codeSigning, 1.3.6.1.5.5.7.3.3
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
`;
writeFileSync(cnfPath, opensslCnf);

function openssl(args) {
  return execFileSync('openssl', args, { stdio: 'pipe', encoding: 'utf8' });
}

// 1) مفتاح RSA 4096
console.log('▸ إنشاء مفتاح خاص RSA 4096 …');
openssl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:4096', '-out', keyPath]);
chmodSync(keyPath, 0o600);

// 2) شهادة ذاتية صالحة 3 سنوات مع EKU codeSigning
console.log('▸ إنشاء شهادة ذاتية X.509 (صالحة 3 سنوات، EKU=codeSigning) …');
openssl(['req', '-new', '-x509', '-days', '1095', '-key', keyPath, '-out', crtPath,
         '-config', cnfPath, '-extensions', 'v3_req']);

// 3) تصدير بصيغة PKCS#12 (PFX) التي يتوقعها electron-builder
console.log('▸ تصدير الحزمة PKCS#12 (.pfx) …');
openssl(['pkcs12', '-export', '-out', pfxPath,
         '-inkey', keyPath, '-in', crtPath,
         '-name', 'TechTouch AI Code Signing',
         '-passout', `pass:${password}`]);
chmodSync(pfxPath, 0o600);

// 4) ترميز Base64 بسطر واحد لـ GitHub Secret WIN_CSC_LINK
console.log('▸ ترميز Base64 (لسر WIN_CSC_LINK) …');
const pfxBytes = readFileSync(pfxPath);
const b64 = pfxBytes.toString('base64');
writeFileSync(pfxB64Path, b64, 'utf8');

// 5) طباعة ملخص الشهادة للتأكد
console.log('\nملخص الشهادة:');
console.log(openssl(['x509', '-in', crtPath, '-noout', '-subject', '-issuer', '-dates', '-ext', 'extendedKeyUsage']));

console.log('─────────────────────────────────────────────────────────');
console.log(`تم إنشاء الملفات في: ${certDir}`);
console.log('');
console.log('أضف المتغيرات التالية كأسرار GitHub (Settings → Secrets → Actions):');
console.log('');
console.log('  WIN_CSC_KEY_PASSWORD =', password);
console.log('  WIN_CSC_LINK         = محتوى الملف التالي (سطر واحد Base64):');
console.log('                         ', pfxB64Path);
console.log('');
console.log('طول السطر (أحرف Base64):', b64.length);
console.log('─────────────────────────────────────────────────────────');
console.log('\nلتثبيت الشهادة محلياً على ويندوز (للثقة بها أثناء التطوير):');
console.log('  powershell -Command "Import-PfxCertificate -FilePath scripts\\\\certs\\\\OfficeManager-CodeSign.pfx -CertStoreLocation Cert:\\\\CurrentUser\\\\Root -Password (ConvertTo-SecureString -String \'' + password + '\' -AsPlainText -Force)"');
