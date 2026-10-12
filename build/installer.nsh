; Custom NSIS script for the Windows installer (electron-builder includes build/installer.nsh).
; Uninstaller: a page with a checkbox to also delete the app data in %APPDATA% (settings, window size, my list and
; watch history, subtitles, caches, local AI models), so a reinstall starts fresh (#10). It is off by default, and an
; update never deletes anything (the old version is uninstalled silently with --updated, which skips the page).
; Downloaded videos and screenshots (Videos\LilacAnime, Pictures\LilacAnime) are the user's files and are kept.
!include nsDialogs.nsh

!ifdef BUILD_UNINSTALLER
  Var deleteAppDataCheckbox
  Var deleteAppData

  ; Inserted after MUI2 and common.nsh are included, so the page functions are defined here.
  !macro customUnWelcomePage
    !insertmacro MUI_UNPAGE_WELCOME
    UninstPage custom un.deleteAppDataPage un.deleteAppDataPageLeave

    Function un.deleteAppDataPage
      ${if} ${isUpdated}
        Abort
      ${endif}
      !insertmacro MUI_HEADER_TEXT "앱 데이터 삭제" "LilacAnime 데이터를 함께 삭제할지 고르세요."
      nsDialogs::Create 1018
      Pop $0
      ${NSD_CreateLabel} 0 0 100% 36u "설정, 창 크기, 내 목록과 시청 기록, 자막, 캐시, 로컬 AI 모델은 제거해도 남아 있어서 다시 설치하면 그대로 이어집니다. 처음 상태로 다시 설치하려면 아래를 체크하세요."
      Pop $0
      ${NSD_CreateCheckbox} 0 44u 100% 12u "LilacAnime 데이터도 삭제"
      Pop $deleteAppDataCheckbox
      ${if} $deleteAppData == "1"
        ${NSD_Check} $deleteAppDataCheckbox
      ${endif}
      ${NSD_CreateLabel} 0 64u 100% 24u "다운로드한 영상(동영상\LilacAnime)과 스크린샷(사진\LilacAnime)은 지우지 않습니다."
      Pop $0
      nsDialogs::Show
    FunctionEnd

    Function un.deleteAppDataPageLeave
      ${NSD_GetState} $deleteAppDataCheckbox $0
      ${if} $0 == ${BST_CHECKED}
        StrCpy $deleteAppData "1"
      ${else}
        StrCpy $deleteAppData "0"
      ${endif}
    FunctionEnd
  !macroend

  ; Same folders electron-builder's own deleteAppDataOnUninstall removes, plus the downloaded update installer.
  !macro customUnInstall
    ${if} $deleteAppData == "1"
    ${andIfNot} ${isUpdated}
      DetailPrint "LilacAnime 데이터 삭제"
      ; Electron keeps app data per user.
      ${if} $installMode == "all"
        SetShellVarContext current
      ${endif}
      RMDir /r "$APPDATA\${APP_FILENAME}"
      !ifdef APP_PRODUCT_FILENAME
        RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
      !endif
      !ifdef APP_PACKAGE_NAME
        RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
      !endif
      RMDir /r "$TEMP\LilacAnime-update"
      ${if} $installMode == "all"
        SetShellVarContext all
      ${endif}
    ${endif}
  !macroend
!endif
