import { createFileRoute } from "@tanstack/react-router"
import { DemoPortsPage } from "~/components/shipping/ports-demo"

export const Route = createFileRoute("/ports")({ component: DemoPortsPage })
