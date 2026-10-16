import { shippingViteConfig } from "../../vite.config"

// Only this explicit build entry can request the synthetic capability.
export default shippingViteConfig(true)
