import { createFileRoute } from "@tanstack/react-router"
import { AnnualCalendarPage } from "~/components/shipping/annual-calendar"

export const Route = createFileRoute("/calendar")({ component: AnnualCalendarPage })
