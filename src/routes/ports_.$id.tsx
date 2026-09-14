import { createFileRoute } from "@tanstack/react-router"
import { PortDetailPage } from "~/components/shipping/pages"

export const Route = createFileRoute("/ports_/$id")({ component: PortDetailRoute })

function PortDetailRoute() {
  return <PortDetailPage id={Route.useParams().id} />
}
