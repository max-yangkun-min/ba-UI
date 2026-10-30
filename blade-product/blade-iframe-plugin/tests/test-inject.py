# -*- coding: utf-8 -*-
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
sample = (root / "tests" / "sample-index.html").read_text(encoding="utf-8")
ver = (root / "VERSION").read_text(encoding="utf-8").strip()
tag = '    <script src="/iframe-auth-bridge.js?v=%s"></script>\n' % ver
html = re.sub(r"\s*<script[^>]+iframe-auth-bridge\.js[^>]*>\s*</script>\s*", "\n", sample)
html2, n = re.subn(r"(\s*)(<script\b)", r"\1" + tag + r"\2", html, count=1)
assert n == 1
assert "iframe-auth-bridge.js?v=" + ver in html2
assert html2.index("iframe-auth-bridge.js") < html2.index('type="module"')
html3 = "\n".join(line for line in html2.splitlines() if "iframe-auth-bridge.js" not in line)
assert "iframe-auth-bridge.js" not in html3
print("ok")

# leftover theme.js tags must be removable without dropping </body>
dirty = sample.replace("</body>", '    <script src="/web/theme.js?v=1"></script></body>')
import subprocess, shutil, tempfile
# python-only equivalent of strip-index.awk
import re as _re
stripped = _re.sub(r"[ \t]*<script[^>]*iframe-auth-bridge\.js[^>]*>[ \t]*</script>[ \t]*", "", dirty)
stripped = _re.sub(r"[ \t]*<script[^>]*theme\.js[^>]*>[ \t]*</script>[ \t]*", "", stripped)
assert "theme.js" not in stripped
assert "</body>" in stripped
print("ok-strip-theme")