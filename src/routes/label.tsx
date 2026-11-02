import { createFileRoute } from "@tanstack/react-router"
import { IntelLabelPage } from "~/components/shipping/intel-label"

export const Route = createFileRoute("/label")({ component: IntelLabelPage })
