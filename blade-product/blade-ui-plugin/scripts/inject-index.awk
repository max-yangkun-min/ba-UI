BEGIN {
  if (ver == "") ver = "0.2.0"
  done = 0
  incomment = 0
}
{
  if (!incomment && index($0, "<!--") > 0) {
    incomment = 1
    if (index($0, "-->") > 0) incomment = 0
    print
    next
  }
  if (!done && !incomment && $0 ~ /<\/head>/) {
    print "    <!-- blade-ui-plugin:start -->"
    print "    <link rel=\"stylesheet\" href=\"/blade-ui-theme.css?v=" ver "\">"
    print "    <script src=\"/blade-ui-theme.js?v=" ver "\"></script>"
    print "    <!-- blade-ui-plugin:end -->"
    done = 1
  }
  if (incomment && index($0, "-->") > 0) incomment = 0
  print
}
END {
  if (!done) {
    print "inject-index.awk: </head> not found" > "/dev/stderr"
    exit 2
  }
}
