!include WinVer.nsh

; يُستدعى من قالب Tauri 2.11 قبل نسخ الملفات (NSIS_HOOK_PREINSTALL).
!macro NSIS_HOOK_PREINSTALL
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "يتطلب «إدارة المكتب» نظام Windows 10 أو Windows 11. Windows 7 و Windows 8 غير مدعومين."
    Abort
  ${EndIf}
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "هذا المثبّت لمعالجات 64-bit فقط. نظام 32-bit غير مدعوم."
    Abort
  ${EndIf}
!macroend
