import { createFileRoute } from "@tanstack/react-router"
import { VesselsPage } from "~/components/shipping/pages"

export const Route = createFileRoute("/vessels")({ component: VesselsPage })
