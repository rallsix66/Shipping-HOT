import { createFileRoute } from "@tanstack/react-router"
import { CalendarPage } from "~/components/shipping/pages"

export const Route = createFileRoute("/calendar")({ component: CalendarPage })
