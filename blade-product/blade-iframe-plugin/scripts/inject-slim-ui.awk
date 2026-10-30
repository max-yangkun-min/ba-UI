BEGIN {
  if (ver == "") ver = "1.0.0"
  tag = "    <script src=\"/blade-ui-slim.js?v=" ver "\"></script>"
  done = 0
  incomment = 0
}
{
  # 见 inject-index.awk：v2610 的注释正文含 "<script src>" 字样，注释内不能插入。
  if (!incomment && index($0, "<!--") > 0) {
    incomment = 1
    if (index($0, "-->") > 0) incomment = 0
    print
    next
  }

  if ($0 ~ /blade-ui-slim\.js/) {
    if (!done && !incomment) {
      print tag
      done = 1
    }
    next
  }
  # 插在第一个 type="module" 的 script 之前：module 都是 defer 执行，
  # 本脚本会先于应用代码运行。
  if (!done && !incomment && $0 ~ /<script[^>]*type="module"/) {
    print tag
    done = 1
  }

  if (incomment && index($0, "-->") > 0) incomment = 0
  print
}
END {
  if (!done) {
    print "inject-slim-ui.awk: no module script tag found" > "/dev/stderr"
    exit 2
  }
}
