import { createFileRoute } from "@tanstack/react-router"
import { FeedRoutePage } from "~/components/shipping/manual-intel"

export const Route = createFileRoute("/feed")({ component: FeedRoutePage })
