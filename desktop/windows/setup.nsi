Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma
!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"

!define APP "Axis-Evo"
!define RELEASE "0.1.0 Preview M7"
!define PREVIOUS_WINDOW "Axis-Evo 0.1.0 Preview · M6.1"
!define CURRENT_WINDOW "Axis-Evo 0.1.0 Preview · M7"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\AxisEvoPreview"

Name "${APP} ${RELEASE}"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\Axis-Evo"
InstallDirRegKey HKCU "${UNINSTALL_KEY}" "InstallLocation"
VIProductVersion "0.1.0.70"
VIAddVersionKey /LANG=1033 "ProductName" "${APP}"
VIAddVersionKey /LANG=1033 "CompanyName" "Axis-Evo"
VIAddVersionKey /LANG=1033 "FileDescription" "Axis-Evo Windows Preview Setup"
VIAddVersionKey /LANG=1033 "FileVersion" "0.1.0.70"
VIAddVersionKey /LANG=1033 "ProductVersion" "${RELEASE}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Axis-Evo"

!define MUI_ICON "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\Axis-Evo.exe"
!define MUI_FINISHPAGE_RUN_TEXT "启动 Axis-Evo"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  SetShellVarContext current
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP|MB_OK "Axis-Evo 需要 64 位 Windows 10 或 11。"
    Abort
  ${EndIf}
  Call RequireClosed
FunctionEnd

!macro RequireAxisClosed errorText
  FindWindow $0 "" "${CURRENT_WINDOW}"
  ${If} $0 = 0
    FindWindow $0 "" "${PREVIOUS_WINDOW}"
  ${EndIf}
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "${errorText}"
    Abort
  ${EndIf}
!macroend

Function RequireClosed
  !insertmacro RequireAxisClosed "请退出 Axis-Evo 后再继续。"
FunctionEnd

Section "Axis-Evo"
  SetShellVarContext current
  Call RequireClosed
  SetOutPath "$INSTDIR"
  SetOverwrite on
  !include "${INSTALL_FILES}"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\Axis-Evo"
  CreateShortCut "$SMPROGRAMS\Axis-Evo\Axis-Evo.lnk" "$INSTDIR\Axis-Evo.exe"
  CreateShortCut "$SMPROGRAMS\Axis-Evo\卸载 Axis-Evo.lnk" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP} ${RELEASE}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${RELEASE}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\Axis-Evo.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "Axis-Evo"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  !insertmacro RequireAxisClosed "请退出 Axis-Evo 后再卸载。"
  !include "${UNINSTALL_FILES}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\Axis-Evo\Axis-Evo.lnk"
  Delete "$SMPROGRAMS\Axis-Evo\卸载 Axis-Evo.lnk"
  RMDir "$SMPROGRAMS\Axis-Evo"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
SectionEnd
