import { createFileRoute } from "@tanstack/react-router"
import { VesselDetailPage } from "~/components/shipping/pages"

export const Route = createFileRoute("/vessels/$id")({ component: VesselDetailRoute })

function VesselDetailRoute() {
  return <VesselDetailPage id={Route.useParams().id} />
}
