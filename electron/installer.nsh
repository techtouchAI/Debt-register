; يُدرج electron-builder هذا الملف قبل سكربت المثبّت.
; preInit يعمل في .onInit قبل واجهة التثبيت، وWinVer.nsh محمّل من القالب.
!macro preInit
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP|MB_OK "يتطلب «إدارة المكتب» نظام Windows 10 أو Windows 11.$\r$\nWindows 7 و Windows 8 و Windows 8.1 غير مدعومة."
    Abort
  ${EndIf}
  !ifndef APP_ARM64
    ${IfNot} ${RunningX64}
      MessageBox MB_ICONSTOP|MB_OK "هذا المثبّت لمعالجات 64-bit (x64) فقط. نظام 32-bit غير مدعوم. إن كان الجهاز ARM64 فثبّت نسخة ARM64."
      Abort
    ${EndIf}
  !endif
!macroend
