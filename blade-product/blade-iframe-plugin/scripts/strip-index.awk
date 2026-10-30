{
  gsub(/[ \t]*<script[^>]*iframe-auth-bridge\.js[^>]*>[ \t]*<\/script>[ \t]*/, "")
  gsub(/[ \t]*<script[^>]*url-token-auth\.js[^>]*>[ \t]*<\/script>[ \t]*/, "")
  gsub(/[ \t]*<script[^>]*blade-ui-slim\.js[^>]*>[ \t]*<\/script>[ \t]*/, "")
  gsub(/[ \t]*<script[^>]*src="\/theme\.js[^>]*>[ \t]*<\/script>[ \t]*/, "")
  if ($0 ~ /^[ \t]*$/) next
  print
}
