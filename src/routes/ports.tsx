import { createFileRoute } from "@tanstack/react-router"
import { PortsPage } from "~/components/shipping/pages"

export const Route = createFileRoute("/ports")({ component: PortsPage })
