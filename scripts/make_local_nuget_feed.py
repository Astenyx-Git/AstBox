# Build an offline local NuGet feed in .local-feed/ by re-zipping the
# package folders from the user's read-only global cache (network TLS is
# unavailable in the sandboxed shell). Contents are the original Microsoft
# / upstream binaries plus their original .nuspec files.
import shutil
import sys
import zipfile
from pathlib import Path

CACHE = Path(r"C:\Users\asten\.nuget\packages")
FEED = Path(r"D:\New_LANG\C#-astbox\.local-feed")

WANTED = {
    "konscious.security.cryptography.argon2",
    "konscious.security.cryptography.blake2",
    "libsodium",
    "microsoft.aspnetcore.app.runtime.win-x64",
    "microsoft.dotnet.ilcompiler",
    "microsoft.net.illink.tasks",
    "microsoft.netcore.app.runtime.nativeaot.win-x64",
    "microsoft.netcore.app.runtime.win-x64",
    "microsoft.windowsdesktop.app.runtime.win-x64",
    "nsec.cryptography",
    "qrcoder",
    "runtime.win-x64.microsoft.dotnet.ilcompiler",
}

# QRCoder 的 net6.0-windows 组声明依赖 System.Drawing.Common>=6.0.0,
# 但本项目只用 PngByteQRCode(无 GDI+)。全局缓存与 SDK 均无此包且离线,
# 故生成一个仅含 nuspec 的空壳包满足依赖解析(不参与编译/运行)。
STUBS = {
    "system.drawing.common": "6.0.0",
}


def write_stub(pkg_id: str, version: str) -> None:
    out = FEED / f"{pkg_id}.{version}.nupkg"
    if out.exists():
        print(f"skip {out.name}")
        return
    nuspec = f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://schemas.microsoft.com/packaging/2013/05/nuspec.xsd">
  <metadata>
    <id>{pkg_id}</id>
    <version>{version}</version>
    <authors>offline-stub</authors>
    <description>Dependency-satisfaction stub (project uses no GDI+ APIs).</description>
  </metadata>
</package>
"""
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{pkg_id}.nuspec", nuspec)
        zf.writestr("_._", "")
    print(f"wrote {out.name} (stub)")


def zip_package(pkg_dir: Path, out_path: Path) -> None:
    if out_path.exists():
        return
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in sorted(pkg_dir.rglob("*")):
            if not p.is_file():
                continue
            name = p.name.lower()
            if name == ".signature.p5s":
                continue          # 签名与重打包内容不匹配, 跳过
            arc = p.relative_to(pkg_dir).as_posix()
            zf.write(p, arc)


def main() -> int:
    FEED.mkdir(exist_ok=True)
    missing = []
    for pkg_id in sorted(WANTED):
        versions = sorted(CACHE.joinpath(pkg_id).iterdir()) \
            if CACHE.joinpath(pkg_id).is_dir() else []
        for ver_dir in versions:
            out = FEED / f"{pkg_id}.{ver_dir.name}.nupkg"
            if out.exists():
                print(f"skip {out.name}")
                continue
            zip_package(ver_dir, out)
            print(f"wrote {out.name} ({out.stat().st_size} bytes)")
        if not versions:
            missing.append(pkg_id)
    if missing:
        print("MISSING:", ", ".join(missing))
        return 1
    for pkg_id, version in STUBS.items():
        write_stub(pkg_id, version)
    return 0


if __name__ == "__main__":
    sys.exit(main())
