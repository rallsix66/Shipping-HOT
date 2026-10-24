import { intelReadHandler } from "#/utils/intel-read"
import { manualChecklist } from "#/intel/manual-checklist"

export default intelReadHandler(async (_event, repo) => ({ items: await manualChecklist(repo) }))
