!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\TachikoSheet.xlsx" "" "Tachiko Sheet Excel Workbook"
  WriteRegStr SHCTX "Software\Classes\TachikoSheet.xlsx\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  WriteRegNone SHCTX "Software\Classes\.xlsx\OpenWithProgids" "TachikoSheet.xlsx" ""
  WriteRegStr SHCTX "Software\Classes\TachikoSheet.csv" "" "Tachiko Sheet CSV File"
  WriteRegStr SHCTX "Software\Classes\TachikoSheet.csv\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  WriteRegNone SHCTX "Software\Classes\.csv\OpenWithProgids" "TachikoSheet.csv" ""
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue SHCTX "Software\Classes\.xlsx\OpenWithProgids" "TachikoSheet.xlsx"
  ; Leave no empty per-user keys behind: remove them only when nothing else is in them.
  DeleteRegKey /ifempty SHCTX "Software\Classes\.xlsx\OpenWithProgids"
  DeleteRegKey /ifempty SHCTX "Software\Classes\.xlsx"
  DeleteRegKey SHCTX "Software\Classes\TachikoSheet.xlsx"
  DeleteRegValue SHCTX "Software\Classes\.csv\OpenWithProgids" "TachikoSheet.csv"
  ; Leave no empty per-user keys behind: remove them only when nothing else is in them.
  DeleteRegKey /ifempty SHCTX "Software\Classes\.csv\OpenWithProgids"
  DeleteRegKey /ifempty SHCTX "Software\Classes\.csv"
  DeleteRegKey SHCTX "Software\Classes\TachikoSheet.csv"
!macroend
