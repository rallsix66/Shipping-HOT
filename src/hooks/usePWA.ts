import { useRegisterSW } from "virtual:pwa-register/react"
import { useMount } from "react-use"
import { useToast } from "./useToast"

export function usePWA() {
  const toaster = useToast()
  const { updateServiceWorker, needRefresh: [needRefresh] } = useRegisterSW()

  useMount(async () => {
    const update = () => {
      updateServiceWorker().then(() => localStorage.setItem("updated", "1"))
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
    if (localStorage.getItem("updated")) {
      localStorage.removeItem("updated")
      toaster("已更新到最新版本")
    } else if (needRefresh) {
      if (!navigator) return
      if ("connection" in navigator && !navigator.onLine) return
      toaster("有新版本，5 秒后自动更新", {
        action: {
          label: "立刻更新",
          onClick: update,
        },
        onDismiss: update,
      })
    }
  })
}
