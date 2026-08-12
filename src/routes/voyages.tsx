import { createFileRoute } from "@tanstack/react-router"
import { VoyagesPage } from "~/components/shipping/pages"

export const Route = createFileRoute("/voyages")({ component: VoyagesPage })
