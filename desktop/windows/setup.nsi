Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma
!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

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

Function RetireM61Assets
  ReadRegStr $0 HKCU "${UNINSTALL_KEY}" "DisplayVersion"
  ${If} $0 S!= "0.1.0 Preview M6.1"
    Return
  ${EndIf}
  ReadRegStr $0 HKCU "${UNINSTALL_KEY}" "InstallLocation"
  ${If} $0 != $INSTDIR
    Return
  ${EndIf}

  StrCpy $1 "$INSTDIR\app\web\dist\assets"
  ${GetRoot} "$1" $2
  ${If} $2 == ""
    Return
  ${EndIf}
  ${While} $1 != $2
    System::Call 'kernel32::GetFileAttributesW(w r1) i.r3'
    ; Require a directory and reject FILE_ATTRIBUTE_REPARSE_POINT.
    IntOp $3 $3 & 0x410
    ${If} $3 <> 0x10
      Return
    ${EndIf}
    ${GetParent} "$1" $1
  ${EndWhile}

  ; Exact paths from the official M6.1 Setup that are absent from the M7 payload.
  StrCpy $0 "$INSTDIR\app\web\dist\assets"
  ClearErrors
  Delete "$0\AgentConversation-tKaywrus.js"
  Delete "$0\AgentSettings-CwjHB5mS.js"
  Delete "$0\AgentWork-BI-J5sx5.js"
  Delete "$0\FilesView-C9VhpiXw.js"
  Delete "$0\LegacyWorkbench-D8_eDzAB.js"
  Delete "$0\ResearchArchive-BIEVtUWz.js"
  Delete "$0\ResearchArchive-CVGZ1oXg.css"
  Delete "$0\RuntimeProviders-BCglSh5I.js"
  Delete "$0\RuntimeWorkbench-CyknVHT6.js"
  Delete "$0\RuntimeWorkbench-DQYavCdC.css"
  Delete "$0\SafeMarkdown-DhI1xtLt.js"
  Delete "$0\SkillEvolutionWorkbench-CdXZ6wdm.js"
  Delete "$0\arrow-left-CWv4mbVI.js"
  Delete "$0\arrow-up-right-bRUiUnWi.js"
  Delete "$0\chevron-right-CyXM9_OE.js"
  Delete "$0\createLucideIcon-DV7PPjHH.js"
  Delete "$0\git-branch-CkDEzHCM.js"
  Delete "$0\git-compare-arrows-BgcE5fEx.js"
  Delete "$0\index-4EM2brsI.js"
  Delete "$0\index-CHs2UWfx.css"
  Delete "$0\lock-keyhole-DXYxcrW7.js"
  Delete "$0\save-DC4-GxdC.js"
  Delete "$0\sun-CoY8IZyG.js"
  Delete "$0\terminal-Dbd94qKM.js"
  ${If} ${Errors}
    MessageBox MB_ICONSTOP|MB_OK "无法清理 M6.1 的旧资源。请关闭占用文件的程序后重试。" /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
FunctionEnd

Section "Axis-Evo"
  SetShellVarContext current
  Call RequireClosed
  SetOutPath "$INSTDIR"
  SetOverwrite on
  !include "${INSTALL_FILES}"
  Call RetireM61Assets
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
