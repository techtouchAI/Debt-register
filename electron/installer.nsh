; يُدرج electron-builder هذا الملف قبل سكربت المثبّت.
; preInit يعمل في .onInit قبل واجهة التثبيت، وWinVer.nsh محمّل من القالب.
;
; يمرر electron-builder وسمات بحسب المعمارية المستهدفة بأسماء محددة
; (راجع NsisTarget في app-builder-lib): APP_64 (وليس APP_X64) لـ x64،
; وAPP_ARM64 لـ ARM64، وAPP_32 لـ ia32. فنرفض الإصدار غير المطابق بدل أن
; تظهر للمستخدم رسالة مضلّلة على المثبّت الصحيح.
; ملاحظة: نبني حالياً x64 وarm64 فقط — Electron 44 أوقف نشر ثنائيات
; ويندوز 32-بت (electron/electron#52326)، ففرع APP_32 احتياطي للمستقبل.
!macro preInit
  ; ---- المتطلب المشترك: Windows 10 فما فوق ----
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP|MB_OK "يتطلب «إدارة المكتب» نظام Windows 10 أو Windows 11.$\r$\nWindows 7 و Windows 8 و Windows 8.1 غير مدعومة."
    Abort
  ${EndIf}

  ; ---- فحص المعمارية المطابقة للإصدار ----
  !ifdef APP_64
    ; الإصدار x64: يجب أن يكون النظام 64-بت وليس ARM64
    ${IfNot} ${RunningX64}
      MessageBox MB_ICONSTOP|MB_OK "هذا المثبّت لمعالجات Intel/AMD 64-bit (x64).$\r$\nعلى أجهزة ARM (مثل Surface Pro X) حمّل إصدار ARM64، وعلى أنظمة 32-بت استخدم نسخة الويب (PWA) — لا يتوفر مثبّت 32-بت منذ Electron 44."
      Abort
    ${EndIf}
  !endif

  !ifdef APP_ARM64
    ; الإصدار ARM64: لا فحص إضافي — NSIS على ARM64 يضبط RunningX64 لكن لا
    ; يمكنه التمييز بين x64 وARM64، فيعتمد المستخدم على اختيار الملف الصحيح.
    ; في Windows 11 on ARM ستعمل نسخة x64 عبر المحاكاة لكننا ننصح بنسخة ARM64.
  !endif

  ; الإصدار ia32 (APP_32): لا يُبنى حالياً (أوقفه Electron 44)، ولا شرط عليه لو بُني.
!macroend
