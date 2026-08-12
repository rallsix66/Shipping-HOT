import { createFileRoute } from "@tanstack/react-router"
import { EventsPage } from "~/components/shipping/pages"

export const Route = createFileRoute("/events")({ component: EventsPage })
