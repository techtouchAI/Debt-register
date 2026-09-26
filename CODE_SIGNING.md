# توقيع ويندوز — دليل الإعداد والبناء

## المطلوب منك (أسرار GitHub)

أضف هذين السرّين في مستودعك على GitHub:

**Settings → Secrets and variables → Actions → New repository secret**

| السر (Secret name) | القيمة |
|---|---|
| `WIN_CSC_KEY_PASSWORD` | `techtouch7` |
| `WIN_CSC_LINK` | محتوى ملف `scripts/certs/OfficeManager-CodeSign.pfx.b64` (سطر Base64 واحد) — قُم بنسخه من المحادثة أعلاه أو ولّده مجدداً بالأمر أدناه |

> ⚠ لا تُدخل ملف `.pfx` أو `.key` أو `.crt` في git — `.gitignore` يمنعها مسبقاً.

## الإنتاج الفعلي بعد إضافة الأسرار

ادفع الفرع وسيقوم سير العمل `.github/workflows/build.yml` تلقائياً بإنتاج 6 ملفات في
أرتيفакт **OfficeManager-Windows**:

| الملف | الوصف |
|---|---|
| `OfficeManager-Setup-1.0.0-x64.exe`    | مثبّت NSIS لـ Windows 10/11 64-بت (Intel/AMD) |
| `OfficeManager-Portable-1.0.0-x64.exe` | نسخة محمولة 64-بت (لا تحتاج تثبيت) |
| `OfficeManager-Setup-1.0.0-ia32.exe`   | مثبّت NSIS لـ Windows 10 32-بت |
| `OfficeManager-Portable-1.0.0-ia32.exe`| نسخة محمولة 32-بت |
| `OfficeManager-Setup-1.0.0-arm64.exe`  | مثبّت NSIS لأجهزة Windows على ARM (Surface Pro X وغيرها) |
| `OfficeManager-Portable-1.0.0-arm64.exe` | نسخة محمولة ARM64 |

## الأوامر المحلية

```bash
# توليد/إعادة توليد شهادة التوقيع الذاتية
npm run certs:generate
# أو بكلمة مرور مخصصة:
CERT_PASSWORD=mysecret npm run certs:generate

# بناء كل المعماريات موقّعة محلياً (يتطلب وجود الشهادة في scripts/certs/)
export WIN_CSC_LINK=$(base64 -w0 scripts/certs/OfficeManager-CodeSign.pfx)
export WIN_CSC_KEY_PASSWORD=techtouch7
npm run build:windows

# بناء معمارية واحدة فقط
npm run build:windows:x64
npm run build:windows:ia32
npm run build:windows:arm64
```

## ملاحظات مهمة عن الشهادة الذاتية

- الشهادة المولّدة هنا **ذاتية Self-Signed** (RSA 4096-bit، صالحة 3 سنوات) بتواقيع SHA-256 و **EKU = Code Signing**.
- هي صالحة للتوقيع وتجنّب تحذير "Unknown publisher" **بعد** أن تثبت الشهادة في مخزن
  "Trusted Root Certification Authorities" على أجهزتك. مع المستخدمين الجدد سيبقى
  تحذير SmartScreen في البداية حتى يكتسب الملف سمعة كافية (تكرار التحميل + سمعة المُوقِّع).
- للنشر العام للمستخدمين النهائيين يُنصح بشراء شهادة **OV أو EV Code Signing** من
  مرجع مصدّق معتمد (DigiCert / Sectigo / GlobalSign) — استبدل ملف `.pfx` وكرر الخطوات.
- توقيع ويندوز في CI يعمل تلقائياً — سير العمل يربط `WIN_CSC_LINK` و
  `WIN_CSC_KEY_PASSWORD` بمتغيرات `CSC_LINK` و `CSC_KEY_PASSWORD` التي يقرؤها
  electron-builder، ثم يتحقق من التوقيع عبر `Get-AuthenticodeSignature` ويفشل
  صراحة إن مُرِّرت شهادة غير صالحة.
