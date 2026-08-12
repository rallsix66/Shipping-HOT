import "~/styles/globals.css"
import "virtual:uno.css"
import { Outlet, createRootRouteWithContext } from "@tanstack/react-router"
import { TanStackRouterDevtools } from "@tanstack/router-devtools"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import type { QueryClient } from "@tanstack/react-query"
import { Toast } from "~/components/common/toast"

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
})

function NotFoundComponent() {
  return <div className="mx-auto max-w-2xl p-12 text-center"><h1 className="text-3xl font-bold">Page not found</h1><p className="mt-2 op-70">Return to Shipping HOT to continue.</p></div>
}

function RootComponent() {
  useOnReload()
  useSync()
  usePWA()
  return (
    <>
      <Outlet />
      <Toast />
      {import.meta.env.DEV && (
        <>
          <ReactQueryDevtools buttonPosition="bottom-left" />
          <TanStackRouterDevtools position="bottom-right" />
        </>
      )}
    </>
  )
}
