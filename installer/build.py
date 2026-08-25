# -*- coding: utf-8 -*-
# Copyright 2026 Astenyx-Git
# SPDX-License-Identifier: Apache-2.0
"""ASTBOX 安装包构建脚本(纯标准库)。

产物:
    stage/Astbox/            便携目录树(嵌入式 Python + 应用)
    dist/AstboxSetup-*.exe   Inno Setup 安装程序(检测到 ISCC 时)
    dist/Astbox-portable.zip 无 ISCC 时的便携包回退

用法:
    python installer/build.py            # 全量构建
    python installer/build.py --no-test  # 跳过启动自检
"""
import argparse
import io
import json
import os
import shutil
import struct
import subprocess
import sys
import time
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                 # win-astbox/
APP_SRC = os.path.join(ROOT, "astbox-decoder")  # 应用源码根
STAGE = os.path.join(HERE, "stage", "Astbox")
CACHE = os.path.join(HERE, "_cache")
DIST = os.path.join(HERE, "dist")

PY_VER = "3.14.6"
APP_VERSION = "V2.0.1"
EMBED_FILE = "python-%s-embed-amd64.zip" % PY_VER
EMBED_URLS = [
    "https://registry.npmmirror.com/-/binary/python/%s/%s"
    % (PY_VER, EMBED_FILE),
    "https://mirrors.huaweicloud.com/python/%s/%s" % (PY_VER, EMBED_FILE),
    "https://www.python.org/ftp/python/%s/%s" % (PY_VER, EMBED_FILE),
]
PTH_NAME = "python3%d._pth" % (int(PY_VER.split(".")[1]),)

TEST_PORT = 18799


def log(msg):
    print("[build] %s" % msg)


def _zip_ok(path):
    """快速校验: 文件尾部存在 ZIP End-Of-Central-Directory 记录。"""
    size = os.path.getsize(path)
    if size < 22:
        return False
    with open(path, "rb") as f:
        f.seek(max(0, size - 70000))
        tail = f.read()
    return tail.rfind(b"PK\x05\x06") != -1


def fetch(url_list, dest):
    """多镜像 + 断点续传下载，ZIP 完整性校验通过后落盘。"""
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.isfile(dest) and os.path.getsize(dest) > 1024 \
            and _zip_ok(dest):
        log("缓存命中: %s" % os.path.basename(dest))
        return dest
    part = dest + ".part"
    last_err = None
    for url in url_list:
        for attempt in (1, 2, 3):
            try:
                have = os.path.getsize(part) if os.path.isfile(part) else 0
                req = urllib.request.Request(url)
                if have:
                    req.add_header("Range", "bytes=%d-" % have)
                with urllib.request.urlopen(req, timeout=60) as resp:
                    total = int(resp.headers.get("Content-Length") or 0)
                    mode = "续传" if have else "下载"
                    with open(part, "ab" if have else "wb") as f:
                        done = have
                        while True:
                            block = resp.read(262144)
                            if not block:
                                break
                            f.write(block)
                            done += len(block)
                            if total:
                                sys.stdout.write(
                                    "\r  %s %d/%d KiB"
                                    % (mode, done // 1024, total // 1024))
                                sys.stdout.flush()
                sys.stdout.write("\n")
                if _zip_ok(part):
                    os.replace(part, dest)
                    log("完成: %s (%.1f MiB)"
                        % (os.path.basename(dest),
                           os.path.getsize(dest) / 1048576))
                    return dest
                raise IOError("ZIP 结构不完整(可能被截断)")
            except Exception as exc:
                last_err = exc
                print("[build] %s 第%d次尝试失败: %r"
                      % (url.split('/')[2], attempt, exc))
    raise SystemExit("全部镜像下载失败: %r" % last_err)


def reset_stage():
    parent = os.path.dirname(STAGE)
    if os.path.isdir(parent):
        import stat

        def _force_rm(func, path, _exc):
            try:
                os.chmod(path, stat.S_IWRITE)
            except Exception:
                pass
            func(path)

        shutil.rmtree(parent, onexc=_force_rm)
    os.makedirs(STAGE)


def stage_runtime():
    zipl = fetch(EMBED_URLS, os.path.join(CACHE, EMBED_FILE))
    runtime = os.path.join(STAGE, "runtime")
    os.makedirs(runtime)
    with zipfile.ZipFile(zipl) as zf:
        zf.extractall(runtime)
    pth = os.path.join(runtime, PTH_NAME)
    if not os.path.isfile(pth):
        raise SystemExit("嵌入式运行时缺少 %s" % PTH_NAME)
    with open(pth, "a", encoding="ascii") as f:
        f.write("\n..\\app\n")     # 使 import astbox 与脚本资源可见
    log("运行时就绪: runtime/ (%s)" % PY_VER)


INSTALL_CMD = "\r\n".join([
    "@echo off",
    "setlocal EnableExtensions",
    "chcp 65001 >nul",
    'set "DEST=%LOCALAPPDATA%\\Programs\\Astbox"',
    'set "SRC=%~dp0Astbox"',
    "echo ============================================",
    "echo   ASTBOX - install to %DEST%",
    "echo ============================================",
    'robocopy "%SRC%" "%DEST%" /MIR /NFL /NDL /NJH /NJS >nul',
    "if errorlevel 8 (",
    "  echo [ERROR] copy failed.",
    "  pause",
    "  exit /b 1",
    ")",
    'copy /y "%~dp0uninstall.cmd" "%DEST%\\uninstall.cmd" >nul',
    'reg add "HKCU\\Software\\Classes\\.astbox" /ve /d "Astbox.Container" /f >nul',
    'reg add "HKCU\\Software\\Classes\\.astbox\\OpenWithProgids" /v "Astbox.Container" /d "" /f >nul',
    'reg add "HKCU\\Software\\Classes\\Astbox.Container" /ve /d "ASTBOX Container" /f >nul',
    'reg add "HKCU\\Software\\Classes\\Astbox.Container\\DefaultIcon" /ve /t REG_EXPAND_SZ /d "%%SystemRoot%%\\system32\\zipfldr.dll" /f >nul',
    'reg add "HKCU\\Software\\Classes\\Astbox.Container\\shell\\open\\command" /ve /d "\\"%DEST%\\runtime\\pythonw.exe\\" \\"%DEST%\\app\\astbox_server.py\\" \\"%%1\\"" /f >nul',
    'reg add "HKCU\\Software\\Classes\\.passbox" /ve /d "Astbox.Passbox" /f >nul',
    'reg add "HKCU\\Software\\Classes\\.passbox\\OpenWithProgids" /v "Astbox.Passbox" /d "" /f >nul',
    'reg add "HKCU\\Software\\Classes\\Astbox.Passbox" /ve /d "ASTBOX 传播包" /f >nul',
    'reg add "HKCU\\Software\\Classes\\Astbox.Passbox\\DefaultIcon" /ve /t REG_EXPAND_SZ /d "%DEST%\\app\\assets\\passbox.ico" /f >nul',
    'reg add "HKCU\\Software\\Classes\\Astbox.Passbox\\shell\\open\\command" /ve /d "\\"%DEST%\\runtime\\pythonw.exe\\" \\"%DEST%\\app\\astbox_server.py\\" --import-passbox \\"%%1\\"" /f >nul',
    'reg add "HKCU\\Software\\Astbox\\Capabilities\\FileAssociations" /v ".passbox" /d "Astbox.Passbox" /f >nul',
    'reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.passbox\\UserChoice" /f >nul 2>&1',
    'reg add "HKCU\\Software\\Astbox\\Capabilities" /v ApplicationName /d "ASTBOX Container Manager" /f >nul',
    'reg add "HKCU\\Software\\Astbox\\Capabilities" /v ApplicationIcon /d "%DEST%\\app\\assets\\astbox.ico" /f >nul',
    'reg add "HKCU\\Software\\Astbox\\Capabilities\\FileAssociations" /v ".astbox" /d "Astbox.Container" /f >nul',
    'reg add "HKCU\\Software\\RegisteredApplications" /v "ASTBOX Container Manager" /d "Software\\Astbox\\Capabilities" /f >nul',
    'set "ARP=HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{8F4A2C63-9D1E-4B57-A6F3-2E5C7A90D411}_is1"',
    'reg add "%ARP%" /v DisplayName /d "ASTBOX V2.0.1" /f >nul',
    'reg add "%ARP%" /v DisplayVersion /d "2.0.1" /f >nul',
    'reg add "%ARP%" /v DisplayIcon /d "%DEST%\\app\\assets\\astbox.ico" /f >nul',
    'reg add "%ARP%" /v UninstallString /d "cmd /c \\"%DEST%\\uninstall.cmd\\"" /f >nul',
    'reg add "%ARP%" /v NoModify /t REG_DWORD /d 1 /f >nul',
    'reg add "%ARP%" /v NoRepair /t REG_DWORD /d 1 /f >nul',
    'powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $lnk = $ws.CreateShortcut([Environment]::GetFolderPath(\'Desktop\') + \'\\ASTBOX.lnk\'); $lnk.TargetPath = \'%DEST%\\runtime\\pythonw.exe\'; $lnk.Arguments = \'\"%DEST%\\app\\astbox_server.py\"\'; $lnk.IconLocation = \'%DEST%\\app\\assets\\astbox.ico\'; $lnk.Save()" >nul 2>&1',
    "echo [OK] installed, .astbox registered.",
    "echo Opening Windows default-apps settings: choose ASTBOX for .astbox",
    "start ms-settings:defaultapps",
    "exit /b 0",
]) + "\r\n"

UNINSTALL_CMD = "\r\n".join([
    "@echo off",
    "setlocal EnableExtensions",
    "chcp 65001 >nul",
    'set "DEST=%LOCALAPPDATA%\\Programs\\Astbox"',
    "echo Stopping ASTBOX service...",
    'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'pythonw.exe\'\\" | Where-Object { $_.CommandLine -like \'*astbox_server*\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1',
    "timeout /t 1 /nobreak >nul",
    'reg delete "HKCU\\Software\\Classes\\.astbox" /f >nul 2>&1',
    'reg delete "HKCU\\Software\\Classes\\.passbox" /f >nul 2>&1',
    'reg delete "HKCU\\Software\\Classes\\Astbox.Passbox" /f >nul 2>&1',
    'reg delete "HKCU\\Software\\Classes\\Astbox.Container" /f >nul 2>&1',
    'reg delete "HKCU\\Software\\Astbox" /f >nul 2>&1',
    'reg delete "HKCU\\Software\\RegisteredApplications" /v "ASTBOX Container Manager" /f >nul 2>&1',
    'reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{8F4A2C63-9D1E-4B57-A6F3-2E5C7A90D411}_is1" /f >nul 2>&1',
    'reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{8F4A2C63-9D1E-4B57-A6F3-2E5C7A90D411}" /f >nul 2>&1',
    'del "%USERPROFILE%\\Desktop\\ASTBOX.lnk" >nul 2>&1',
    'rmdir /s /q "%DEST%"',
    "echo [OK] ASTBOX removed (.astbox association unregistered).",
    "pause",
]) + "\r\n"


def write_installer_scripts(stage_root):
    def put(name, text):
        with open(os.path.join(stage_root, name), "wb") as f:
            f.write(text.encode("utf-8"))
    # 放在独立目录；打包时置于 ZIP 根（与 Astbox/ 平级）
    out_dir = os.path.join(HERE, "stage_scripts")
    os.makedirs(out_dir, exist_ok=True)
    put(os.path.basename(out_dir), "")  # no-op 占位避免误用
    with open(os.path.join(out_dir, "install.cmd"), "wb") as f:
        f.write(INSTALL_CMD.encode("utf-8"))
    with open(os.path.join(out_dir, "uninstall.cmd"), "wb") as f:
        f.write(UNINSTALL_CMD.encode("utf-8"))
    log("installer scripts written (stage_scripts/)")


COPY_ITEMS = [
    ("astbox_server.py", "astbox_server.py"),
    ("astbox", "astbox"),
    ("gui", "gui"),
    # 预编译依赖(argon2-cffi 等) —— 运行时解锁/封装必需
    ("deps", "deps"),
]


def stage_app():
    dst_app = os.path.join(STAGE, "app")
    os.makedirs(dst_app)
    for src_rel, dst_rel in COPY_ITEMS:
        src = os.path.join(APP_SRC, src_rel)
        dst = os.path.join(dst_app, dst_rel)
        if os.path.isdir(src):
            shutil.copytree(src, dst,
                            ignore=shutil.ignore_patterns(
                                "__pycache__", "*.pyc", "tmp", "deps"))
        else:
            shutil.copy2(src, dst)
    # 图标
    icon_src = os.path.join(HERE, "assets", "astbox.ico")
    os.makedirs(os.path.join(dst_app, "assets"), exist_ok=True)
    shutil.copy2(icon_src, os.path.join(dst_app, "assets", "astbox.ico"))
    pb_icon_src = os.path.join(HERE, "assets", "passbox.ico")
    if os.path.isfile(pb_icon_src):
        shutil.copy2(pb_icon_src,
                     os.path.join(dst_app, "assets", "passbox.ico"))
    # 许可文本(Apache-2.0 合规: 再分发须随附 LICENSE/NOTICE)
    repo_root = os.path.dirname(HERE)
    for doc in ("LICENSE", "NOTICE"):
        doc_src = os.path.join(repo_root, doc)
        if os.path.isfile(doc_src):
            shutil.copy2(doc_src, os.path.join(STAGE, doc))
    # 签名公钥证书(方案A: 随包分发, 用户可选导入受信任根)
    cer_src = os.path.join(HERE, "assets", "Astbox.cer")
    if os.path.isfile(cer_src):
        shutil.copy2(cer_src, os.path.join(STAGE, "Astbox.cer"))
    # chromium 通道目录(与脚本同级，应用按 _HERE/chromium 探测)
    chr_dst = os.path.join(dst_app, "chromium")
    os.makedirs(chr_dst, exist_ok=True)
    readme_src = os.path.join(APP_SRC, "chromium", "README.txt")
    if os.path.isfile(readme_src):
        shutil.copy2(readme_src, os.path.join(chr_dst, "README.txt"))
    log("应用负载就绪: app/")


def sanity_boot():
    """用打包出的运行时真实拉起服务并走一次 shutdown 握手。"""
    pyw = os.path.join(STAGE, "runtime", "python.exe")
    script = os.path.join(STAGE, "app", "astbox_server.py")
    proc = subprocess.Popen(
        [pyw.replace("pythonw.exe", "python.exe"), script,
         "--port", str(TEST_PORT), "--no-browser"],
        cwd=os.path.join(STAGE, "app"),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    import urllib.request
    ok = False
    for _ in range(30):
        time.sleep(0.4)
        try:
            with urllib.request.urlopen(
                    "http://127.0.0.1:%d/api/state" % TEST_PORT,
                    timeout=2) as r:
                if r.status == 200:
                    ok = True
                    break
        except Exception:
            continue
    if not ok:
        proc.kill()
        raise SystemExit("自检失败: 打包运行时未能启动服务")

    def post(route, payload):
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            "http://127.0.0.1:%d%s" % (TEST_PORT, route), data=data,
            headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.loads(r.read().decode("utf-8"))

    # 完整密码学自检: 生成(低内存 KDF) -> 解锁，验证 argon2 在打包运行时可用
    test_dst = os.path.join(STAGE, "_selfcheck.astbox")
    d = post("/api/demo", {"dst": test_dst, "digits": 6,
                           "profile": "constrained"})
    if not d.get("ok"):
        proc.kill()
        raise SystemExit("自检失败: 容器生成异常")
    t = post("/api/totp", {"b32": d["demo"]["b32"], "digits": 6})
    u = post("/api/unlock", {"totp": t["code"]})
    if not u.get("ok") or u["state"]["phase"] != "unlocked":
        proc.kill()
        raise SystemExit("自检失败: 解锁失败(argon2 依赖缺失?)")
    log("自检: 容器生成+解锁 OK (%d 条目)" % len(u["state"]["items"]))
    try:
        os.remove(test_dst)
    except OSError:
        pass

    req = urllib.request.Request(
        "http://127.0.0.1:%d/api/shutdown" % TEST_PORT,
        data=b"{}", headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=5):
        pass
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
        raise SystemExit("自检失败: shutdown 后进程未退出")
    log("自检通过: 打包运行时启动/生成/解锁/退出均正常")


def sign_file(path):
    """Authenticode 签名(PowerShell 原生, 无需 SDK)。

    配置: 环境变量 ASTBOX_SIGN_PFX(pfx 路径) + ASTBOX_SIGN_PW(密码);
    可选 ASTBOX_SIGN_TS 时间戳服务器。未配置则跳过。
    """
    pfx = os.environ.get("ASTBOX_SIGN_PFX")
    if not pfx or not os.path.isfile(pfx):
        log("未配置 ASTBOX_SIGN_PFX, 跳过签名: %s" % os.path.basename(path))
        return
    ts = os.environ.get("ASTBOX_SIGN_TS",
                        "http://timestamp.digicert.com")
    ps = (
        "$pw=[Environment]::GetEnvironmentVariable('ASTBOX_SIGN_PW');"
        "$c=New-Object System.Security.Cryptography.X509Certificates."
        "X509Certificate2('%s',$pw);"
        "$r=Set-AuthenticodeSignature -FilePath '%s' -Certificate $c "
        "-IncludeChain All -TimeStampServer '%s' -HashAlgorithm SHA256;"
        "if($r.Status -ne 'Valid'){throw ('sign failed: '+$r.Status)}"
        "else{Write-Output ('signed OK: '+$r.Status)}"
        % (pfx.replace("'", "''"), path.replace("'", "''"), ts)
    )
    log("签名: %s" % os.path.basename(path))
    subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                   check=True)


def find_iscc():
    cands = [
        r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        r"C:\Program Files\Inno Setup 6\ISCC.exe",
        os.path.join(os.environ.get("LOCALAPPDATA", ""),
                     r"Programs\Inno Setup 6\ISCC.exe"),
    ]
    for c in cands:
        if os.path.isfile(c):
            return c
    from shutil import which
    return which("ISCC")


def make_portable_zip(out_name="Astbox-portable.zip"):
    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, out_name)
    scripts = os.path.join(HERE, "stage_scripts")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) \
            as zf:
        for base, _dirs, files in os.walk(STAGE):
            for fn in files:
                full = os.path.join(base, fn)
                rel = os.path.relpath(full, STAGE)
                zf.write(full, os.path.join("Astbox", rel))
        # 安装脚本置于 ZIP 根，与 Astbox/ 平级（install.cmd 依赖此布局）
        for fn in ("install.cmd", "uninstall.cmd"):
            p = os.path.join(scripts, fn)
            if os.path.isfile(p):
                zf.write(p, fn)
    log("便携包: %s (%.1f MiB)" % (out, os.path.getsize(out) / 1048576))


def find_local_chromium():
    """定位本地已解压的便携内核: APP_SRC/chromium/<版本目录>/chrome.exe"""
    root = os.path.join(APP_SRC, "chromium")
    hits = []
    if os.path.isdir(root):
        for entry in sorted(os.listdir(root)):
            cand = os.path.join(root, entry)
            if os.path.isdir(cand) and \
                    os.path.isfile(os.path.join(cand, "chrome.exe")):
                hits.append(cand)
    return hits


def stage_chromium():
    """把本地便携内核复制进 stage 的 chromium/（应用期望 chromium\\chrome.exe）"""
    hits = find_local_chromium()
    if not hits:
        raise SystemExit("未找到便携内核：请在 astbox-decoder\\chromium\\ 下放置 "
                         "含 chrome.exe 的已解压目录，或检查路径")
    src = hits[0]
    dst = os.path.join(STAGE, "app", "chromium")   # 与 astbox_server.py 同级
    if os.path.isdir(dst):          # 移除 stage_app 建的 README 占位目录
        import stat

        def _force_rm(func, path, _exc):
            try:
                os.chmod(path, stat.S_IWRITE)
            except Exception:
                pass
            func(path)

        shutil.rmtree(dst, onexc=_force_rm)
    log("复制内核: %s -> chromium/" % os.path.basename(src))
    shutil.copytree(src, dst,
                    ignore=shutil.ignore_patterns("*.pdb", "*.pyc"))
    with open(os.path.join(dst, "VERSION"), "w", encoding="utf-8") as f:
        f.write(os.path.basename(src) + "\n")
    if not os.path.isfile(os.path.join(dst, "chrome.exe")):
        raise SystemExit("内核复制后缺少 chrome.exe")
    mb = sum(os.path.getsize(os.path.join(b, f2))
             for b, _d, fs in os.walk(dst) for f2 in fs) / 1048576
    log("内核就绪: chromium/ (%.0f MiB)" % mb)


def main():
    if sys.stdout is not None and hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-test", action="store_true")
    ap.add_argument("--variant", choices=["both", "slim", "chromium"],
                    default="both",
                    help="both=双版本(默认) slim=精简 chromium=内核版")
    ap.add_argument("--chromium", action="store_true",
                    help="等价于 --variant chromium")
    args = ap.parse_args()
    variant = "chromium" if args.chromium else args.variant

    log("重置 stage/")
    reset_stage()
    stage_runtime()
    stage_app()
    write_installer_scripts(STAGE)
    if not args.no_test:
        sanity_boot()

    iscc = find_iscc()

    def compile_setup(defs):
        if not iscc:
            log("未找到 ISCC，跳过 EXE 编译（仅便携 ZIP）。")
            return
        log("使用 ISCC 编译安装程序...")
        subprocess.run([iscc] + defs + [os.path.join(HERE, "astbox.iss")],
                       check=True, cwd=HERE)

    def report(exe_name):
        p = os.path.join(DIST, exe_name)
        if os.path.isfile(p):
            log("安装程序: %s (%.1f MiB)"
                % (p, os.path.getsize(p) / 1048576))
            sign_file(p)

    if variant in ("both", "slim"):
        make_portable_zip("Astbox-portable.zip")
        compile_setup([])
        report("AstboxSetup-%s.exe" % APP_VERSION)

    if variant in ("both", "chromium"):
        stage_chromium()
        make_portable_zip("Astbox-portable-Chromium.zip")
        compile_setup(["/DChromiumBuild"])
        report("AstboxSetup-Chromium-%s.exe" % APP_VERSION)

    if not iscc:
        log("安装 EXE：安装 Inno Setup 6 后重跑本脚本，或手动执行 astbox.iss。")

    manifest = {
        "python": PY_VER,
        "built": time.strftime("%Y-%m-%d %H:%M:%S"),
        "channels": ["portable-chromium", "edge/chrome-app-window"],
    }
    with open(os.path.join(DIST, "manifest.json"), "w",
              encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
