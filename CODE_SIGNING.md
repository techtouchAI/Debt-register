# توقيع ويندوز — دليل الإعداد والبناء

## المطلوب منك (أسرار GitHub)

أضف هذين السرّين في مستودعك على GitHub:

**Settings → Secrets and variables → Actions → New repository secret**

| السر (Secret name) | القيمة |
|---|---|
| `WIN_CSC_KEY_PASSWORD` | `techtouch7` |
| `WIN_CSC_LINK` | محتوى ملف `scripts/certs/OfficeManager-CodeSign.pfx.b64` (سطر Base64 واحد) — قُم بنسخه من المحادثة أعلاه أو ولّده مجدداً بالأمر أدناه |

> ⚠ لا تُدخل ملف `.pfx` أو `.key` أو `.crt` في git — `.gitignore` يمنعها مسبقاً.

### ⚠ تحقّق من القبلتين قبل الحفظ (خطأ نسخ شائع)

كلمة سر ناقصة أو base64 ناقصة لا تُنتج رسالة واضحة من GitHub — بل يخرج
`signtool` بخطأ غامض أو، أسوأ، يُبنى التطبيق **غير موقّع** ويمرّ البناء:

| السر | كيف تتأكد |
|---|---|
| `WIN_CSC_LINK` | سطر Base64 واحد بلا مسافات/أسطر جديدة، طول تقريبي ~6k حرف (RSA-4096). الأهم: يفكّ إلى PKCS#12 يفتح بكلمة المرور ويحمل EKU=codeSigning. |
| `WIN_CSC_KEY_PASSWORD` | كلمة المرور **نصاً**. لا تضع التجزئة (sha256) ولا `Bearer` ولا القيمة المولّدة من `gh secret` — وتأكد أن لصقاً لم يضِف مسافة قبل/بعد. |

للتحقق محلياً قبل الرفع:

```bash
# 1) هل الـ base64 سليمة؟ (يجب ألا يبقى أي شيء بعد الإزالة)
tr -d 'A-Za-z0-9+/=\n\r' < scripts/certs/OfficeManager-CodeSign.pfx.b64
# 2) هل تفتح بكلمة المرور؟ (يجب أن يطبع openssl بيانات الشهادة، لا "Mac verify error")
tr -d '\n\r' < scripts/certs/OfficeManager-CodeSign.pfx.b64 \
  | base64 -d > /tmp/t.pfx \
  && openssl pkcs12 -in /tmp/t.pfx -nokeys -passin pass:techtouch7 -info | head -20
# 3) هل EKU = codeSigning؟
openssl pkcs12 -in /tmp/t.pfx -nokeys -passin pass:techtouch7 2>/dev/null \
  | openssl x509 -noout -ext extendedKeyUsage
```

## الإنتاج الفعلي بعد إضافة الأسرار

ادفع الفرع وسيقوم سير العمل `.github/workflows/build.yml` تلقائياً بإنتاج 4 ملفات في
أرتيفакт **OfficeManager-Windows**:

| الملف | الوصف |
|---|---|
| `OfficeManager-Setup-1.0.0-x64.exe`    | مثبّت NSIS لـ Windows 10/11 64-بت (Intel/AMD) |
| `OfficeManager-Portable-1.0.0-x64.exe` | نسخة محمولة 64-بت (لا تحتاج تثبيت) |
| `OfficeManager-Setup-1.0.0-arm64.exe`  | مثبّت NSIS لأجهزة Windows على ARM (Surface Pro X وغيرها) |
| `OfficeManager-Portable-1.0.0-arm64.exe` | نسخة محمولة ARM64 |

> لا يوجد مثبّت لأنظمة ويندوز 32-بت: سلسلة Electron 44 أوقفت نشر ثنائيات
> `win32-ia32` نهائياً (electron/electron#52326)، وتُغطّى تلك الأجهزة عبر
> نسخة الويب (PWA).

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
npm run build:windows:arm64
```

## ملاحظات مهمة عن الشهادة الذاتية

- الشهادة المولّدة هنا **ذاتية Self-Signed** (RSA 4096-bit، صالحة 3 سنوات) بتواقيع SHA-256 و **EKU = Code Signing**.
- هي صالحة للتوقيع وتجنّب تحذير "Unknown publisher" **بعد** أن تثبت الشهادة في مخزن
  "Trusted Root Certification Authorities" على أجهزتك. مع المستخدمين الجدد سيبقى
  تحذير SmartScreen في البداية حتى يكتسب الملف سمعة كافية (تكرار التحميل + سمعة المُوقِّع).
- للنشر العام للمستخدمين النهائيين يُنصح بشراء شهادة **OV أو EV Code Signing** من
  مرجع مصدّق معتمد (DigiCert / Sectigo / GlobalSign) — استبدل ملف `.pfx` وكرر الخطوات.
- توقيع ويندوز في CI **إلزامي** عندما تكون الشهادة صالحة، لا تحسين اختياري.
  سير العمل الآن:
  1. يفكّ `WIN_CSC_LINK` (Base64) إلى ملف `.pfx` حقيقي، ويدعم بادئة
     `data:...;base64,` إن وُجدت.
  2. يفتح الملف بكلمة المرور عبر .NET **قبل** البناء، ويفحص: وجود المفتاح
     الخاص، تاريخ الصلاحية، وامتداد `EKU = codeSigning`. أي خلل يُبلَّغ كـ
     `::error::` برسالة السبب بدل أن ينهار البناء بخطأ غامض من `signtool`.
  3. يُدخل الشهادة في مخزن `Root/CurrentUser` على العدّاء (لحظي) حتى تُرجع
     `Get-AuthenticodeSignature` الحالة `Valid` بدل `UnknownError` — فالفرق بين
     الحالتين هو انعدام الثقة، لا سلامة التوقيع.
  4. يمرّر **مسار الملف** إلى electron-builder (لا الـ base64) فيتخطّى فكّ
     الترميز المزدوج.
  5. **يفشل البناء** إن كانت الشهادة صالحة ولم يظهر توقيع Authenticode على
     أيٍّ من الملفات الخمسة (مثبّت/محمول × x64/arm64 + التنفيذ الداخلي)، أو
     إن خالف المُوقِّع البصمة المتوقعة.

  عند غياب `WIN_CSC_LINK` تماماً يبقى البناء ناجحاً بلا توقيع مع `::warning::`
  ظاهر في السجل — حتى تعمل المستودعات المتفرّعة.
- الختم الزمني RFC3161 مربوط صراحةً بـ `http://timestamp.digicert.com` داخل
  `electron-builder.json`، وelectron-builder 26 يعيد المحاولة مرّتين تلقائياً
  عند فشل خادم الختم. إن ظهر تحذير "توقيع بلا ختم زمني" فقد تعذّر الوصول
  للخدمة في تلك اللحظة.
