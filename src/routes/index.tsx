import { createFileRoute } from "@tanstack/react-router"
import { CountryOverviewPage } from "~/components/shipping/country-overview"

export const Route = createFileRoute("/")({
  component: IndexComponent,
})

function IndexComponent() {
  return <CountryOverviewPage />
}
