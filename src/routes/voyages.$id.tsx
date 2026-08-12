import { createFileRoute } from "@tanstack/react-router"
import { VoyageDetailPage } from "~/components/shipping/pages"

export const Route = createFileRoute("/voyages/$id")({ component: VoyageDetailRoute })

function VoyageDetailRoute() {
  return <VoyageDetailPage id={Route.useParams().id} />
}
