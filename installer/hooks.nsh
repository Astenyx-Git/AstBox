; ASTBOX NSIS installer hooks (Tauri v2 bundle.windows.nsis.installerHooks).
; 关联清理 / 密钥库保留策略与 C# 版对齐(exp.md §1.1/§2.1)。
; 全部 HKCU per-user —— 免管理员, 与 Rust 首跑写入对称。
;
; 已知耦合: Tauri per-user 安装目录 = %LOCALAPPDATA%\ASTBOX(productName),
; 与密钥库 %LOCALAPPDATA%\ASTBOX\secrets.bin 同目录。NSIS 卸载 RMDir 会
; 连密钥库一起删 → PREUNINSTALL 先抢救, POSTUNINSTALL 回写(保留策略)。

!macro NSIS_HOOK_POSTINSTALL
  ; §5.2 floor(规范 MUST): 清除悬空 UserChoice(ProgId 键在 Classes 下
  ; 已不存在), 恢复 Classes 默认回退。运行期 ceiling 由首跑
  ; check_association_nudge 承担(spec §5.3)。
  ; 纯 IfErrors 跳转流(不依赖 LogicLib)。
  ClearErrors
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.astbox\UserChoice" "ProgId"
  IfErrors assoc_pb_done 0
    ClearErrors
    EnumRegKey $1 HKCU "Software\Classes\$0" 0
    IfErrors 0 assoc_pb_done
      DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.astbox\UserChoice"
  assoc_pb_done:

  ClearErrors
  ReadRegStr $2 HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.passbox\UserChoice" "ProgId"
  IfErrors assoc_pb2_done 0
    ClearErrors
    EnumRegKey $3 HKCU "Software\Classes\$2" 0
    IfErrors 0 assoc_pb2_done
      DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.passbox\UserChoice"
  assoc_pb2_done:

  ; S2' 旧版检测/迁移在应用首跑执行(s2::detect_legacy), 时序 =
  ; InstallFiles 之后、关联写入之前(spec §6.2);安装器侧不做注册表
  ; 契约写入, 避免 iss/wxs/活机三通道再次漂移。
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; 密钥库抢救(secrets.bin + 历史备份, 通配整组)
  CreateDirectory "$TEMP\astbox-secret-keep"
  CopyFiles /SILENT "$LOCALAPPDATA\ASTBOX\secrets.bin*" "$TEMP\astbox-secret-keep\"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; 关联清理(exp.md §2.2-4): 删除 ProgId/Capabilities/RegisteredApplications。
  ; DeleteRegKey 不带 /ifempty = 连同子键递归删除。
  DeleteRegKey HKCU "Software\Classes\.astbox"
  DeleteRegKey HKCU "Software\Classes\Astbox.Container"
  DeleteRegKey HKCU "Software\Classes\.passbox"
  DeleteRegKey HKCU "Software\Classes\Astbox.Passbox"
  DeleteRegKey /ifempty HKCU "Software\Astbox\Capabilities"
  DeleteRegValue HKCU "Software\RegisteredApplications" "ASTBOX"

  ; 密钥库保留策略: 回写抢救出的密钥库(CurrentUser DPAPI 换机不可迁移,
  ; 卸载重装零重录 —— exp.md §2.1-#3)。
  CreateDirectory "$LOCALAPPDATA\ASTBOX"
  CopyFiles /SILENT "$TEMP\astbox-secret-keep\secrets.bin*" "$LOCALAPPDATA\ASTBOX\"
  RMDir /r "$TEMP\astbox-secret-keep"
!macroend
