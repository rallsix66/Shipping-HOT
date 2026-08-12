import { ourongxing, react } from "@ourongxing/eslint-config"

const config = ourongxing({
  type: "app",
  // 貌似不能 ./ 开头，
  ignores: ["src/routeTree.gen.ts", "imports.app.d.ts", "public/", ".vscode", "**/*.json"],
}).append(react({
  files: ["src/**"],
}))

/** @type {any} */
const stableConfig = config

export default stableConfig
