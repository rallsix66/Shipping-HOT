import process from "node:process"
import { CLIP_SYNTHETIC_TEST } from "@shared/clip-build"
import { assertClipSyntheticRun } from "#/runtime/clip-synthetic-guard"

// Module evaluation precedes the server listener. No guard in normal builds.
if (CLIP_SYNTHETIC_TEST) assertClipSyntheticRun(process.cwd(), process.env)
export default defineNitroPlugin(() => {})
