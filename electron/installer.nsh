; يُدرج electron-builder هذا الملف قبل سكربت المثبّت.
; preInit يعمل في .onInit قبل واجهة التثبيت، وWinVer.nsh محمّل من القالب.
;
; يمرر electron-builder وسمات APP_64 / APP_X64 / APP_ARM64 / APP_IA32
; بحسب المعمارية المستهدفة، فنرفض الإصدار غير المطابق بدل تعليمه للمستخدم
; رسالة مضلّلة ("هذا المثبّت لـ64-بت") تظهر حتى على المثبّت الصحيح.
!macro preInit
  ; ---- المتطلب المشترك: Windows 10 فما فوق ----
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP|MB_OK \
      "يتطلب «إدارة المكتب» نظام Windows 10 أو Windows 11.$\r$\n$\r$\nWindows 7 و Windows 8 و Windows 8.1 غير مدعومة."
    Abort
  ${EndIf}

  ; ---- فحص المعمارية المطابقة للإصدار ----
  !ifdef APP_X64
    ; الإصدار x64: يجب أن يكون النظام 64-بت وليس ARM64
    ${IfNot} ${RunningX64}
      MessageBox MB_ICONSTOP|MB_OK \
        "هذا المثبّت لمعالجات Intel/AMD 64-bit (x64).$\r$\n$\r$\nيرجى تحميل إصدار 32-bit (x86) إذا كان جهازك قديمًا، أو إصدار ARM64 لأجهزة مثل Surface Pro X."
      Abort
    ${EndIf}
  !endif

  !ifdef APP_ARM64
    ; الإصدار ARM64: لا فحص إضافي — NSIS على ARM64 يضبط RunningX64 لكن لا
    ; يمكنه التمييز بين x64 وARM64، فيعتمد المستخدم على اختيار الملف الصحيح.
    ; في Windows 11 on ARM ستعمل نسخة x64 عبر المحاكاة لكننا ننصح بنسخة ARM64.
  !endif

  ; الإصدار ia32 (x86): لا شرط — يعمل على كل من Windows 32-bit و64-bit.
!macroend
