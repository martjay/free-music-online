; 卸载时不要弹出命令行窗口。
; 安装到 Program Files 时当前用户没有删除权限，需要提权后再删目录。
; 卸载程序自己还占着目录时，等它退出再删。

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'taskkill /F /IM "FreeMusicOnline.exe"'
  Pop $0
  nsExec::Exec 'taskkill /F /IM "anhe-player.exe"'
  Pop $0
  nsExec::Exec 'taskkill /F /IM "AnhePlayer.exe"'
  Pop $0
  SetOutPath $TEMP
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  SetOutPath $TEMP
  StrLen $0 "$INSTDIR"
  ${If} $0 > 8
  ${AndIf} $INSTDIR != "$PROGRAMFILES"
  ${AndIf} $INSTDIR != "$PROGRAMFILES64"
  ${AndIf} $INSTDIR != "$PROGRAMFILES32"
    ClearErrors
    FileOpen $1 "$INSTDIR\~wtest" w
    ${If} ${Errors}
      StrCpy $2 "runas"
    ${Else}
      FileClose $1
      Delete "$INSTDIR\~wtest"
      RMDir /r "$INSTDIR"
      StrCpy $2 "open"
    ${EndIf}

    IfFileExists "$INSTDIR\*.*" 0 fmo_uninstall_cleanup_done
      System::Call 'kernel32::GetCurrentProcessId() i .r3'
      FileOpen $1 "$TEMP\fmo-uninstall.ps1" w
      FileWrite $1 "Wait-Process -Id $3 -ErrorAction SilentlyContinue$\r$\n"
      FileWrite $1 "Remove-Item -LiteralPath '$INSTDIR' -Recurse -Force -ErrorAction SilentlyContinue$\r$\n"
      FileWrite $1 "Remove-Item -LiteralPath '$TEMP\fmo-uninstall.ps1' -Force -ErrorAction SilentlyContinue$\r$\n"
      FileClose $1
      System::Call 'shell32::ShellExecute(p 0, t "$2", t "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe", t "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File $\"$TEMP\fmo-uninstall.ps1$\"", p 0, i 0)'
    fmo_uninstall_cleanup_done:
  ${EndIf}
!macroend
