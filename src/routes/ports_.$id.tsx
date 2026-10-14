import { createFileRoute } from "@tanstack/react-router"
import { DemoPortsPage } from "~/components/shipping/ports-demo"

export const Route = createFileRoute("/ports_/$id")({ component: PortDetailRoute })

function PortDetailRoute() {
  return <DemoPortsPage id={Route.useParams().id} />
}
