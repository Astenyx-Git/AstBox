#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ASTBOX C#/.NET 10 安装包构建脚本(纯标准库)。

版本号自动跟随 installer/build.py 的 APP_VERSION(加 "C#" 后缀):
    python 版本 V2.0.1  ->  产物 AstboxSetup-V2.0.1C#.exe

布局(stage/Astbox):
    astbox-server.exe      NativeAOT 服务端(GUI 由其托管)
    astbox-cli.exe         命令行工具
    libsodium.dll          原生依赖(AOT 发布目录带出)
    gui/                   前端零改动复用(astbox-decoder/gui)
    assets/                图标与证书(installer/assets)

签名(与 build.py sign_file 同款):
    环境变量 ASTBOX_SIGN_PFX(pfx 路径) + ASTBOX_SIGN_PW(密码);
    可选 ASTBOX_SIGN_TS 时间戳服务器(默认 digicert)。
    未配置则跳过签名。对负载内 astbox-server/astbox-cli.exe 与最终
    Setup EXE 都会尝试签名。

用法:
    python installer/build_cs.py                # 默认双版本: 精简 + 内核
    python installer/build_cs.py --no-chromium  # 仅精简版
"""
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
STAGE = os.path.join(HERE, "stage", "Astbox")
SERVER_PUB = os.path.join(ROOT, ".server-publish")
CLI_PUB = os.path.join(ROOT, ".cli-publish")
GUI_SRC = os.path.join(ROOT, "gui")             # 前端(自 astbox-decoder 迁出)
CHROMIUM_SRC = os.path.join(ROOT, "chromium")   # 便携内核(自 astbox-decoder 迁出)
ASSETS_SRC = os.path.join(HERE, "assets")
DIST = os.path.join(HERE, "dist")

CS_SUFFIX = "C#"


def log(msg):
    print("[build-cs] %s" % msg)


def detect_app_version():
    """版本来源: installer/VERSION(随 python 侧最后一次发布写入)。

    python 构建脚本(build.py)已随 python 实现移除; 升版时直接改本文件。
    """
    ver_path = os.path.join(HERE, "VERSION")
    with open(ver_path, "r", encoding="utf-8") as f:
        v = f.read().strip()
    if not v:
        raise SystemExit("installer/VERSION 为空, 无法确定版本")
    return v


def sign_file(path):
    """Authenticode 签名(PowerShell 原生, 无需 SDK)—— 移植自 build.py。

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


def copy_publish(pub, names, dest):
    os.makedirs(dest, exist_ok=True)
    for name in names:
        src = os.path.join(pub, name)
        if not os.path.isfile(src):
            raise SystemExit("缺少发布产物: %s" % src)
        shutil.copy2(src, os.path.join(dest, name))
        log("copied %s (%d bytes)" % (name, os.path.getsize(src)))


def find_local_chromium():
    """定位本地已解压的便携内核: astbox-decoder/chromium/<版本>/chrome.exe"""
    hits = []
    if os.path.isdir(CHROMIUM_SRC):
        for entry in sorted(os.listdir(CHROMIUM_SRC)):
            cand = os.path.join(CHROMIUM_SRC, entry)
            if os.path.isdir(cand) \
                    and os.path.isfile(os.path.join(cand, "chrome.exe")):
                hits.append(cand)
    return hits


def stage_chromium():
    """把本地便携内核复制进 stage 的 chromium/(服务端按 _HERE/chromium 探测)"""
    hits = find_local_chromium()
    if not hits:
        raise SystemExit("未找到便携内核: 请在 astbox-decoder\\chromium\\ 下 "
                         "放置含 chrome.exe 的已解压目录")
    src = hits[0]
    dst = os.path.join(STAGE, "chromium")   # 与 astbox-server.exe 同级
    log("复制内核: %s -> chromium/" % os.path.basename(src))
    shutil.copytree(src, dst,
                    ignore=shutil.ignore_patterns("*.pdb", "*.pyc"))
    with open(os.path.join(dst, "VERSION"), "w", encoding="utf-8") as f:
        f.write(os.path.basename(src) + "\n")
    mb = sum(os.path.getsize(os.path.join(b, f2))
             for b, _d, fs in os.walk(dst) for f2 in fs) / 1048576
    log("内核就绪: chromium/ (%.0f MiB)" % mb)


def stage():
    reset_stage()

    # 服务端 exe 与原生依赖(pdb/NuGet 配置不打包)
    for entry in os.listdir(SERVER_PUB):
        if entry.endswith(".pdb") or entry == "NuGet.Config":
            continue
        src = os.path.join(SERVER_PUB, entry)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(STAGE, entry))
    copy_publish(CLI_PUB, ["astbox-cli.exe"], STAGE)

    # gui 前端零改动
    dst_gui = os.path.join(STAGE, "gui")
    shutil.copytree(GUI_SRC, dst_gui)
    log("gui/ staged (%d files)" %
        sum(len(f) for _, _, f in os.walk(dst_gui)))

    # assets(图标 + 分发用公钥证书)
    shutil.copytree(ASSETS_SRC, os.path.join(STAGE, "assets"))
    log("assets/ staged")

    # 健全性: 关键文件存在
    for required in ("astbox-server.exe", "astbox-cli.exe",
                     "libsodium.dll", "gui", "assets"):
        if not os.path.exists(os.path.join(STAGE, required)):
            raise SystemExit("SANITY FAIL: %s missing" % required)

    # 打包前自检: 负载 CLI 密码学自检真实跑通(等价 build.py 的 sanity_boot)
    cli = os.path.join(STAGE, "astbox-cli.exe")
    r = subprocess.run([cli, "selftest"], capture_output=True, timeout=300)
    if r.returncode != 0:
        raise SystemExit("自检失败: 打包负载 CLI selftest 未通过\n%r"
                         % r.stderr[-400:])
    log("自检通过: 负载 CLI selftest OK")


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


def main():
    if sys.stdout is not None and hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    no_chromium = "--no-chromium" in sys.argv[1:]

    app_version = detect_app_version()           # e.g. V2.0.1
    label = app_version + CS_SUFFIX              # e.g. V2.0.1C#
    num = label[1:]                              # 2.0.1C#
    log("本包版本: %s (VERSION 文件)" % label)

    stage()

    iscc = find_iscc()
    if not iscc:
        raise SystemExit("未找到 ISCC(Inno Setup 6), 无法编译安装程序")

    def compile_and_report(channel_defs, out_name):
        subprocess.run([iscc] + channel_defs +
                       ["/DAppVersionNum=%s" % num,
                        "/DAppVersionLabel=%s" % label,
                        os.path.join(HERE, "astbox-cs.iss")],
                       check=True, cwd=HERE)
        out_path = os.path.join(DIST, out_name)
        if not os.path.isfile(out_path):
            raise SystemExit("编译完成但未找到产物: %s" % out_path)
        sign_file(out_path)
        log("安装程序: %s (%.1f MiB)"
            % (out_path, os.path.getsize(out_path) / 1048576))

    # 签名负载内我方可执行文件(未配置证书则自动跳过)
    for exe in ("astbox-server.exe", "astbox-cli.exe"):
        sign_file(os.path.join(STAGE, exe))

    channels = []

    # ① 精简版(无内核; 运行时回退系统浏览器 --app 窗口)
    compile_and_report([], "AstboxSetup-%s.exe" % label)
    channels.append("slim")

    # ② 内核版(stage 加入 chromium/ 后重编译)
    if not no_chromium:
        stage_chromium()
        compile_and_report(["/DChromiumBuild"],
                           "AstboxSetup-%s-Chromium.exe" % label)
        channels.append("chromium")

    manifest = {
        "app_version": label,
        "channels": channels,
        "runtime": ".NET 10 NativeAOT",
        "built": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    import json
    with open(os.path.join(DIST, "manifest.json"), "w",
              encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    log("manifest.json 已更新")


if __name__ == "__main__":
    main()
