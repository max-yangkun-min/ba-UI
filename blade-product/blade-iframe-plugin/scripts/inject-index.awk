BEGIN {
  if (ver == "") ver = "1.0.0"
  tag = "    <script src=\"/iframe-auth-bridge.js?v=" ver "\"></script>"
  done = 0
  incomment = 0
}
{
  # v2610 的 index.html 在 <!-- --> 注释正文里写了 "<script src>" 字样
  # （埋点引导的说明文字）。早期版本用宽松的 /<script/ 匹配，会把标签插进
  # 注释内部导致脚本被注释掉、桥接静默失效。这里改成：
  #   1) 只认真正的 module script 标签
  #   2) 跟踪注释状态，注释内不做任何插入
  if (!incomment && index($0, "<!--") > 0) {
    incomment = 1
    if (index($0, "-->") > 0) incomment = 0
    print
    next
  }

  if ($0 ~ /iframe-auth-bridge\.js/) {
    if (!done && !incomment) {
      print tag
      done = 1
    }
    next
  }

  if (!done && !incomment && $0 ~ /<script[^>]*type="module"/) {
    print tag
    done = 1
  }

  if (incomment && index($0, "-->") > 0) incomment = 0
  print
}
END {
  if (!done) {
    print "inject-index.awk: no module script tag found" > "/dev/stderr"
    exit 2
  }
}
