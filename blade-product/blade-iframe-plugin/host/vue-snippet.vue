<script setup>
import { onBeforeUnmount, onMounted, ref } from "vue"

const props = defineProps({
  src: { type: String, required: true },
  token: { type: String, required: true },
})

const frame = ref(null)
let onMessage = null

function sendToken() {
  const value = props.token.trim().replace(/^Bearer\s+/i, "")
  if (!value || !frame.value?.contentWindow) return
  frame.value.contentWindow.postMessage(
    { type: "blade-embed-token", token: value },
    new URL(props.src).origin,
  )
}

onMounted(() => {
  onMessage = (event) => {
    if (event.source !== frame.value?.contentWindow) return
    if (event.origin !== new URL(props.src).origin) return
    if (event.data?.type === "blade-embed-ready") sendToken()
  }
  window.addEventListener("message", onMessage)
})

onBeforeUnmount(() => {
  if (onMessage) window.removeEventListener("message", onMessage)
})
</script>

<template>
  <iframe ref="frame" :src="src" style="width: 100%; height: 100%; border: 0" />
</template>
