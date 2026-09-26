; يُدرج electron-builder هذا الملف قبل سكربت المثبّت.
; preInit يعمل في .onInit قبل واجهة التثبيت، وWinVer.nsh محمّل من القالب.
;
; يمرر electron-builder وسمات بحسب المعمارية المستهدفة بأسماء محددة
; (راجع NsisTarget في app-builder-lib): APP_64 (وليس APP_X64) لـ x64،
; وAPP_ARM64 لـ ARM64، وAPP_32 (وليس APP_IA32) لـ ia32. فنرفض الإصدار
; غير المطابق بدل أن تظهر للمستخدم رسالة مضلّلة على المثبّت الصحيح.
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
      MessageBox MB_ICONSTOP|MB_OK "هذا المثبّت لمعالجات Intel/AMD 64-bit (x64).$\r$\nيرجى تحميل إصدار 32-bit (x86) إذا كان جهازك قديمًا، أو إصدار ARM64 لأجهزة مثل Surface Pro X."
      Abort
    ${EndIf}
  !endif

  !ifdef APP_ARM64
    ; الإصدار ARM64: لا فحص إضافي — NSIS على ARM64 يضبط RunningX64 لكن لا
    ; يمكنه التمييز بين x64 وARM64، فيعتمد المستخدم على اختيار الملف الصحيح.
    ; في Windows 11 on ARM ستعمل نسخة x64 عبر المحاكاة لكننا ننصح بنسخة ARM64.
  !endif

  ; الإصدار ia32 (APP_32): لا شرط — يعمل على كل من Windows 32-bit و64-bit.
!macroend
