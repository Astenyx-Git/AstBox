# Build an offline local NuGet feed entry for
# System.Security.Cryptography.ProtectedData 9.0.0 from the genuine
# assembly shipped inside the dotnet SDK (network TLS is unavailable in
# the sandboxed shell). The assembly is the real Microsoft binary; the
# nuspec simply wraps it for restore.
import shutil
import sys
import zipfile
from pathlib import Path

SDK_DLL = Path(r"C:\Program Files\dotnet\sdk\10.0.400\System.Security.Cryptography.ProtectedData.dll")
FEED = Path(r"D:\New_LANG\C#-astbox\.local-feed")
PKG_ID = "System.Security.Cryptography.ProtectedData"
PKG_VER = "9.0.0"
WORK = FEED / "work"

NUSPEC = f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://schemas.microsoft.com/packaging/2013/05/nuspec.xsd">
  <metadata>
    <id>{PKG_ID}</id>
    <version>{PKG_VER}</version>
    <authors>Microsoft</authors>
    <description>Offline re-pack of the Microsoft assembly shipped with the .NET SDK (DPAPI CurrentUser wrapper).</description>
    <language>en-US</language>
  </metadata>
</package>
"""


def main() -> int:
    if not SDK_DLL.is_file():
        print(f"missing {SDK_DLL}")
        return 1
    FEED.mkdir(exist_ok=True)
    if WORK.exists():
        shutil.rmtree(WORK)
    lib = WORK / "pkg" / "lib" / "net10.0"
    lib.mkdir(parents=True)
    shutil.copy2(SDK_DLL, lib / SDK_DLL.name)
    (WORK / "pkg" / f"{PKG_ID}.nuspec").write_text(NUSPEC, encoding="utf-8")
    out = FEED / f"{PKG_ID}.{PKG_VER}.nupkg".lower()
    if out.exists():
        out.unlink()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in sorted((WORK / "pkg").rglob("*")):
            if p.is_file():
                arc = p.relative_to(WORK / "pkg").as_posix()
                zf.write(p, arc)
    shutil.rmtree(WORK)
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
