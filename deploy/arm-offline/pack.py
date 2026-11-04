#!/usr/bin/env python3
"""Build the ARM offline tarball. Run on the packaging machine, not on site."""

import io
import os
import re
import tarfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STAGE = "20261103-blade-arm-offline"
OUT = ROOT / "deliver" / f"{STAGE}.tar.gz"
BINARY_EXT = {".ttf", ".woff", ".woff2", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".eot", ".zip"}
JWT = re.compile(br"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")
AGENT_LOG = re.compile(br"// #region agent log.*?// #endregion\r?\n?", re.S)


def payload(path: Path) -> bytes:
    raw = path.read_bytes()
    if path.suffix.lower() in BINARY_EXT or b"\0" in raw[:4096]:
        return raw
    return raw.replace(b"\r\n", b"\n").replace(b"\r", b"\n")


def add(tar: tarfile.TarFile, arcname: str, data: bytes, mode: int) -> None:
    info = tarfile.TarInfo(f"{STAGE}/{arcname}")
    info.size = len(data)
    info.mode = mode
    info.mtime = int(time.time())
    info.uid = 0
    info.gid = 0
    info.uname = "root"
    info.gname = "root"
    tar.addfile(info, io.BytesIO(data))


def add_tree(tar: tarfile.TarFile, source: Path, prefix: str) -> None:
    for path in sorted(source.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(source).as_posix()
        if "node_modules" in rel.split("/") or path.name.endswith(".map"):
            raise SystemExit("refusing to pack %s" % path)
        mode = 0o755 if path.suffix == ".sh" else 0o644
        add(tar, f"{prefix}/{rel}", payload(path), mode)


def add_plugin(tar: tarfile.TarFile, source: Path, prefix: str) -> None:
    allowed = {"VERSION", "plugin.json", "install.sh", "uninstall.sh", "rollback.sh", "status.sh"}
    for path in sorted(source.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(source)
        if rel.parts[0] not in {"scripts", "files"} and rel.name not in allowed:
            continue
        mode = 0o755 if path.suffix == ".sh" else 0o644
        data = payload(path)
        if path.name == "blade-ui-theme.js":
            data = AGENT_LOG.sub(b"", data)
        if path.suffix in {".js", ".css"} and (b"127.0.0.1" in data or b"192.168.171.128" in data):
            raise SystemExit("plugin file has a lab address: %s" % path)
        add(tar, f"{prefix}/{rel.as_posix()}", data, mode)


def main() -> None:
    embed_js = next((ROOT / "blade-product" / "embed-app" / "dist" / "assets").glob("index-*.js"))
    shell_js = next((ROOT / "public-service" / "dist" / "assets").glob("index-*.js"))
    for built in (embed_js, shell_js):
        text = built.read_text(encoding="utf-8", errors="replace")
        for banned in ("192.168.171.128", "127.0.0.1", "eyJ"):
            if banned in text:
                raise SystemExit("%s contains %s" % (built, banned))
    embed_text = embed_js.read_text(encoding="utf-8", errors="replace")
    if "__BLADE_PUBLIC_HOST__" not in embed_text or ":8020" not in embed_text or ":8010" not in embed_text:
        raise SystemExit("embed bundle is missing the runtime host")
    shell_text = shell_js.read_text(encoding="utf-8", errors="replace")
    if "__EMBED_ORIGIN__" not in shell_text:
        raise SystemExit("shell bundle is missing the runtime origin")
    for needle in ("常用排行", "写作沟通", "文档处理"):
        if needle not in embed_text:
            raise SystemExit("embed bundle is missing %s" % needle)
    for needle in ("智能体创建", "知识库搭建", "技能开发", "MCP工具接入", "提示词模板", "scrolling"):
        if needle not in shell_text:
            raise SystemExit("shell bundle is missing %s" % needle)
    if "对海作战" in embed_text:
        raise SystemExit("embed bundle still has the old skill categories")

    if OUT.exists():
        OUT.unlink()
    with tarfile.open(OUT, "w:gz", format=tarfile.PAX_FORMAT) as tar:
        deploy = ROOT / "deploy" / "arm-offline"
        for name in ("install.sh", "uninstall.sh", "proxy.env.example"):
            add(tar, name, payload(deploy / name), 0o755 if name.endswith(".sh") else 0o644)
        add(tar, "部署说明.md", payload(ROOT / "部署说明.md"), 0o644)
        add(tar, "大系统嵌入说明.md", payload(ROOT / "大系统嵌入说明.md"), 0o644)
        add(tar, "embed-app/serve.py", payload(ROOT / "blade-product" / "embed-app" / "serve.py"), 0o644)
        space_example = payload(ROOT / "blade-product" / "embed-app" / "space-urls.json.example")
        for needle in (
            b"https://www.baidu.com",
            b"https://www.jd.com",
            b"/opt/embed-app/space-urls.json",
            b"DEV_SPACE_URL",
            b"ADMIN_SPACE_URL",
        ):
            if needle not in space_example:
                raise SystemExit("space-urls example missing %s" % needle.decode())
        if b"EMBED_TOKEN" in space_example or b"eyJ" in space_example:
            raise SystemExit("space-urls example has a secret")
        add(tar, "embed-app/space-urls.json.example", space_example, 0o644)
        add(tar, "public-service/serve.py", payload(deploy / "serve-static.py"), 0o644)
        example = ROOT / "public-service" / ".env.example"
        example_data = payload(example)
        for line in (
            b"VITE_DEV_SPACE_URL=https://www.baidu.com",
            b"VITE_ADMIN_SPACE_URL=https://www.jd.com",
        ):
            if line not in example_data:
                raise SystemExit("public-service/.env.example is missing %s" % line.decode())
        add(tar, "public-service/.env.example", example_data, 0o644)
        add_tree(tar, ROOT / "blade-product" / "embed-app" / "dist", "embed-app/dist")
        add_tree(tar, ROOT / "public-service" / "dist", "public-service/dist")
        add_plugin(tar, ROOT / "blade-product" / "blade-iframe-plugin", "blade-iframe-plugin")
        add_plugin(tar, ROOT / "blade-product" / "blade-ui-plugin", "blade-ui-plugin")
        add_tree(tar, deploy / "experts", "experts")

    problems = []
    with tarfile.open(OUT, "r:gz") as tar:
        members = tar.getmembers()
        names = [item.name.replace("\\", "/") for item in members]
        if any("node_modules" in name for name in names):
            problems.append("node_modules path")
        if any(name.endswith(".env.local") or name.endswith("/.env") or name.endswith("/proxy.env") for name in names):
            problems.append("env file")
        if any("import-skills.py" in name or "/sync/" in name or name.endswith(".tar.gz") for name in names):
            problems.append("skill or agent archive in " + name)
        required = [
            f"{STAGE}/install.sh",
            f"{STAGE}/uninstall.sh",
            f"{STAGE}/部署说明.md",
            f"{STAGE}/大系统嵌入说明.md",
            f"{STAGE}/proxy.env.example",
            f"{STAGE}/embed-app/dist/index.html",
            f"{STAGE}/embed-app/dist/blade-site.js",
            f"{STAGE}/embed-app/serve.py",
            f"{STAGE}/embed-app/space-urls.json.example",
            f"{STAGE}/public-service/dist/index.html",
            f"{STAGE}/public-service/dist/shell-site.js",
            f"{STAGE}/public-service/serve.py",
            f"{STAGE}/public-service/.env.example",
            f"{STAGE}/blade-iframe-plugin/install.sh",
            f"{STAGE}/blade-iframe-plugin/files/iframe-auth-bridge.js",
            f"{STAGE}/blade-ui-plugin/install.sh",
            f"{STAGE}/blade-ui-plugin/files/blade-ui-theme.css".replace(
                "blade-ui-theme.css", "files/blade-ui-theme-ba.css"
            ),
            f"{STAGE}/blade-ui-plugin/files/fonts/AlimamaShuHeiTi.ttf",
            f"{STAGE}/blade-ui-plugin/files/fonts/DINAlternate-Bold.ttf",
        ]
        # The replace above was a clumsy way to name the css file. Check explicitly.
        required = [item for item in required if not item.endswith("files/files/blade-ui-theme-ba.css")]
        required.append(f"{STAGE}/blade-ui-plugin/files/blade-ui-theme-ba.css")
        required.append(f"{STAGE}/blade-ui-plugin/files/blade-ui-theme-bh.css")
        required.append(f"{STAGE}/blade-ui-plugin/files/blade-ui-theme.js")
        required.append(f"{STAGE}/blade-ui-plugin/VERSION")
        required.append(f"{STAGE}/blade-iframe-plugin/VERSION")
        required.append(f"{STAGE}/experts/README.md")
        for expert in (
            "制度合规核对",
            "政务数字化材料",
            "信息报送",
            "督查推进",
            "会议安排",
            "会议纪要",
            "简报摘要",
            "材料综合",
            "合同审查",
            "制度文件撰写",
            "幻灯片专家",
            "人事专家",
            "文档处理专家",
        ):
            required.append(f"{STAGE}/experts/{expert}/scenario.json")
        ui_ver = tar.extractfile(f"{STAGE}/blade-ui-plugin/VERSION").read().strip()
        iframe_ver = tar.extractfile(f"{STAGE}/blade-iframe-plugin/VERSION").read().strip()
        if ui_ver != b"0.2.104":
            problems.append("ui version %s" % ui_ver)
        ui_css = tar.extractfile(f"{STAGE}/blade-ui-plugin/files/blade-ui-theme-ba.css").read()
        if b"data-resize-handle" not in ui_css or b"width: 9px" not in ui_css:
            problems.append("ui css missing the 9px resize hit area")
        ui_js = tar.extractfile(f"{STAGE}/blade-ui-plugin/files/blade-ui-theme.js").read()
        if b"127.0.0.1" in ui_js or b"agent log" in ui_js:
            problems.append("ui script still has debug logging")
        if iframe_ver != b"1.1.28":
            problems.append("iframe version %s" % iframe_ver)
        notes = tar.extractfile(f"{STAGE}/部署说明.md").read().decode("utf-8")
        for needle in ("20261103-blade-arm-offline", "http://<生产IP>:5173/resources/agents", "http://<生产IP>:5173/console/app-dev/factory", "20261022-skills"):
            if needle not in notes:
                problems.append("部署说明 missing " + needle)
        if "import-skills" in notes:
            problems.append("部署说明 has an import script")
        for item in required:
            if item not in names:
                problems.append("missing " + item)
        for member in members:
            extracted = tar.extractfile(member)
            if extracted is None:
                continue
            data = extracted.read()
            if JWT.search(data):
                problems.append("token-like bytes in " + member.name)
            if b"\r\n" in data and not member.name.endswith(tuple(BINARY_EXT)):
                if b"\0" not in data[:4096]:
                    problems.append("CRLF in " + member.name)
        site = tar.extractfile(f"{STAGE}/embed-app/dist/blade-site.js").read()
        if b"192.168.171.128" in site or b"127.0.0.1" in site:
            problems.append("blade-site.js has a fixed address")
        shell = tar.extractfile(f"{STAGE}/public-service/dist/shell-site.js").read()
        if b"192.168.171.128" in shell or b"127.0.0.1" in shell:
            problems.append("shell-site.js has a fixed address")
        for folder in ("embed-app/dist", "public-service/dist"):
            for member in members:
                if f"/{folder}/" not in member.name.replace("\\", "/"):
                    continue
                extracted = tar.extractfile(member)
                if extracted is None:
                    continue
                blob = extracted.read()
                if b"192.168.171.128" in blob or b"127.0.0.1" in blob or JWT.search(blob):
                    problems.append("frontend hit in " + member.name)
        for member in members:
            if "/experts/" not in member.name.replace("\\", "/"):
                continue
            extracted = tar.extractfile(member)
            if extracted is None:
                continue
            blob = extracted.read()
            if b"192.168.171.128" in blob or b"127.0.0.1" in blob or JWT.search(blob):
                problems.append("expert file has a lab address or token-like bytes: " + member.name)
    if problems:
        raise SystemExit("\n".join(problems))
    print("OK")
    print(OUT)
    print(os.path.getsize(OUT))
    print("members", len(names))


if __name__ == "__main__":
    main()
