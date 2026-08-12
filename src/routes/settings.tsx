import { createFileRoute } from "@tanstack/react-router"
import { SettingsPage } from "~/components/shipping/pages"

export const Route = createFileRoute("/settings")({ component: SettingsPage })
