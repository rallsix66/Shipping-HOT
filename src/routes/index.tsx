import { createFileRoute } from "@tanstack/react-router"
import { HotPage } from "~/components/shipping/pages"

export const Route = createFileRoute("/")({
  component: IndexComponent,
})

function IndexComponent() {
  return <HotPage />
}
