Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma
!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!define APP "Axis-Evo"
!define RELEASE "0.1.0 Preview M7.1"
!define CURRENT_WINDOW "Axis-Evo 0.1.0 Preview - M7.1"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\AxisEvoPreview"

Name "${APP} ${RELEASE}"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\Axis-Evo"
InstallDirRegKey HKCU "${UNINSTALL_KEY}" "InstallLocation"
VIProductVersion "0.1.0.71"
VIAddVersionKey /LANG=1033 "ProductName" "${APP}"
VIAddVersionKey /LANG=1033 "CompanyName" "Axis-Evo"
VIAddVersionKey /LANG=1033 "FileDescription" "Axis-Evo Windows Preview Setup"
VIAddVersionKey /LANG=1033 "FileVersion" "0.1.0.71"
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
    ; Match launchers from the two supported upgrade sources.
    IntFmt $1 "%c" 0xB7
    FindWindow $0 "" "Axis-Evo 0.1.0 Preview $1 M7"
    ${If} $0 = 0
      FindWindow $0 "" "Axis-Evo 0.1.0 Preview $1 M6.1"
    ${EndIf}
  ${EndIf}
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "${errorText}"
    Abort
  ${EndIf}
!macroend

Function RequireClosed
  !insertmacro RequireAxisClosed "请退出 Axis-Evo 后再继续。"
FunctionEnd

!macro DeleteRetiredAppFile path
  !if ! /FileExists "${APP_PAYLOAD}\${path}"
    Delete "$INSTDIR\app\${path}"
  !endif
!macroend

!macro DeleteRetiredWebFile path
  !insertmacro DeleteRetiredAppFile "web\dist\${path}"
!macroend

Function RetireFrontendFiles
  ReadRegStr $4 HKCU "${UNINSTALL_KEY}" "DisplayVersion"
  ${If} $4 S!= "0.1.0 Preview M6.1"
  ${AndIf} $4 S!= "0.1.0 Preview M7"
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

  ; Each allowlist comes from that release, excluding files present in the new payload.
  StrCpy $1 "$INSTDIR\app\licenses"
  System::Call 'kernel32::GetFileAttributesW(w r1) i.r3'
  IntOp $3 $3 & 0x410
  ClearErrors
  ${If} $3 = 0x10
    !insertmacro DeleteRetiredAppFile "licenses\node_modules_@radix-ui_colors_LICENSE"
  ${EndIf}
  ${If} $4 S== "0.1.0 Preview M6.1"
    !insertmacro DeleteRetiredWebFile "assets\AgentConversation-tKaywrus.js"
    !insertmacro DeleteRetiredWebFile "assets\AgentSettings-CwjHB5mS.js"
    !insertmacro DeleteRetiredWebFile "assets\AgentWork-BI-J5sx5.js"
    !insertmacro DeleteRetiredWebFile "assets\FilesView-C9VhpiXw.js"
    !insertmacro DeleteRetiredWebFile "assets\LegacyWorkbench-D8_eDzAB.js"
    !insertmacro DeleteRetiredWebFile "assets\ResearchArchive-BIEVtUWz.js"
    !insertmacro DeleteRetiredWebFile "assets\ResearchArchive-CVGZ1oXg.css"
    !insertmacro DeleteRetiredWebFile "assets\RuntimeProviders-BCglSh5I.js"
    !insertmacro DeleteRetiredWebFile "assets\RuntimeWorkbench-CyknVHT6.js"
    !insertmacro DeleteRetiredWebFile "assets\RuntimeWorkbench-DQYavCdC.css"
    !insertmacro DeleteRetiredWebFile "assets\SafeMarkdown-DhI1xtLt.js"
    !insertmacro DeleteRetiredWebFile "assets\SkillEvolutionWorkbench-CdXZ6wdm.js"
    !insertmacro DeleteRetiredWebFile "assets\arrow-left-CWv4mbVI.js"
    !insertmacro DeleteRetiredWebFile "assets\arrow-up-right-bRUiUnWi.js"
    !insertmacro DeleteRetiredWebFile "assets\chevron-right-CyXM9_OE.js"
    !insertmacro DeleteRetiredWebFile "assets\createLucideIcon-DV7PPjHH.js"
    !insertmacro DeleteRetiredWebFile "assets\git-branch-CkDEzHCM.js"
    !insertmacro DeleteRetiredWebFile "assets\git-compare-arrows-BgcE5fEx.js"
    !insertmacro DeleteRetiredWebFile "assets\index-4EM2brsI.js"
    !insertmacro DeleteRetiredWebFile "assets\index-CHs2UWfx.css"
    !insertmacro DeleteRetiredWebFile "assets\lock-keyhole-DXYxcrW7.js"
    !insertmacro DeleteRetiredWebFile "assets\save-DC4-GxdC.js"
    !insertmacro DeleteRetiredWebFile "assets\sun-CoY8IZyG.js"
    !insertmacro DeleteRetiredWebFile "assets\terminal-Dbd94qKM.js"
  ${Else}
    !insertmacro DeleteRetiredWebFile "assets\ResearchArchive-FsSoiI3F.css"
    !insertmacro DeleteRetiredWebFile "assets\ResearchArchive-hc3W6zVx.js"
    !insertmacro DeleteRetiredWebFile "assets\RuntimeEntry-7MbRaDX_.js"
    !insertmacro DeleteRetiredWebFile "assets\RuntimeEntry-BuHzCoqn.css"
    !insertmacro DeleteRetiredWebFile "assets\RuntimeProviders-BBvpWpPq.js"
    !insertmacro DeleteRetiredWebFile "assets\SafeMarkdown-B3v1hDwh.css"
    !insertmacro DeleteRetiredWebFile "assets\SafeMarkdown-ux74fizB.js"
    !insertmacro DeleteRetiredWebFile "assets\SkillEvolutionWorkbench-Csmqs5Fc.css"
    !insertmacro DeleteRetiredWebFile "assets\SkillEvolutionWorkbench-y4Io4Rhe.js"
    !insertmacro DeleteRetiredWebFile "assets\index-B9LYzwwi.js"
    !insertmacro DeleteRetiredWebFile "assets\index-Bei6ndae.css"
    !insertmacro DeleteRetiredWebFile "assets\jsx-runtime-Bzw2jH9X.js"
    !insertmacro DeleteRetiredWebFile "assets\lock-keyhole-B3N-eJXh.js"
    !insertmacro DeleteRetiredWebFile "axis-dark.png"
    !insertmacro DeleteRetiredWebFile "axis-light.png"
  ${EndIf}
  ${If} ${Errors}
    MessageBox MB_ICONSTOP|MB_OK "无法清理旧版前端资源。请关闭占用文件的程序后重试。" /SD IDOK
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
  Call RetireFrontendFiles
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
