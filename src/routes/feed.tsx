import { createFileRoute } from "@tanstack/react-router"
import { FeedPage } from "~/components/shipping/pages"

export const Route = createFileRoute("/feed")({ component: FeedPage })
