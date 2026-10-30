BEGIN { skip = 0 }
{
  if (index($0, "blade-ui-plugin:start") > 0) {
    skip = 1
    next
  }
  if (index($0, "blade-ui-plugin:end") > 0) {
    skip = 0
    next
  }
  if (skip) next
  if ($0 ~ /blade-ui-theme\.css/ || $0 ~ /blade-ui-theme\.js/) next
  print
}
