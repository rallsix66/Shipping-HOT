import { createFileRoute } from "@tanstack/react-router"
import { PoliciesPage } from "~/components/shipping/policies"

export const Route = createFileRoute("/policies")({ component: PoliciesPage })
