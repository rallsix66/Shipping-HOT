import { type PortDirectoryRecord, portDirectoryBaseline } from "@shared/port-directory"

const order = ["CNYTN", "CNSHK", "CNNSA", "VNSGN", "THLCH", "MYPKG", "IDJKT", "PHMNL"]
export const demoFocusPorts: readonly (PortDirectoryRecord & { shippingPortId: string })[] = order.map(code => portDirectoryBaseline.find(p => p.unlocode === code)!)
