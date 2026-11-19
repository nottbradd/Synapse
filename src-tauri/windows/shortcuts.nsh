; Explorer resolves the taskbar group through the Start menu shortcut for its AppUserModelID.
; A separate icon path keeps upgrades from inheriting the cached icon for synapse.exe.
!macro SynapseUpdateShortcutIcon shortcut
  !insertmacro IsShortcutTarget "${shortcut}" "$INSTDIR\${MAINBINARYNAME}.exe"
  Pop $3
  ${If} $3 = 1
    !insertmacro ComHlpr_CreateInProcInstance ${CLSID_ShellLink} ${IID_IShellLink} r0 ""
    ${If} $0 P<> 0
      ${IUnknown::QueryInterface} $0 '("${IID_IPersistFile}",.r1)'
      ${If} $1 P<> 0
        ${IPersistFile::Load} $1 '("${shortcut}", ${STGM_READWRITE})i.r2'
        ${If} $2 = 0
          ${IShellLink::SetIconLocation} $0 '("$INSTDIR\synapse-frost.ico", 0)i.r2'
          ${If} $2 = 0
            ${IPersistFile::Save} $1 '("${shortcut}", 1)i.r2'
            ${If} $2 = 0
              ; SHCNE_UPDATEITEM, SHCNF_PATHW | SHCNF_FLUSH
              System::Call 'shell32::SHChangeNotify(i 0x2000, i 0x1005, w "${shortcut}", p 0)'
            ${EndIf}
          ${EndIf}
        ${EndIf}
        ${IUnknown::Release} $1 ""
      ${EndIf}
      ${IUnknown::Release} $0 ""
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  Push $0
  Push $1
  Push $2
  Push $3
  !if "${STARTMENUFOLDER}" != ""
    !insertmacro SynapseUpdateShortcutIcon "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
  !else
    !insertmacro SynapseUpdateShortcutIcon "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  !endif
  !insertmacro SynapseUpdateShortcutIcon "$DESKTOP\${PRODUCTNAME}.lnk"
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend
