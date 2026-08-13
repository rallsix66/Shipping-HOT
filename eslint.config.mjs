import { ourongxing, react } from "@ourongxing/eslint-config"

const config = ourongxing({
  type: "app",
  // 貌似不能 ./ 开头，
  ignores: ["src/routeTree.gen.ts", "imports.app.d.ts", "public/", ".vscode", "**/*.json"],
}).append(react({
  files: ["src/**"],
}))

/** @type {any} */
const stableConfig = config.removeRules(
  "react-dom/no-children-in-void-dom-elements",
  "react/ensure-forward-ref-using-ref",
  "react/no-access-state-in-setstate",
  "react/no-array-index-key",
  "react/no-children-count",
  "react/no-children-for-each",
  "react/no-children-map",
  "react/no-children-only",
  "react/no-children-prop",
  "react/no-children-to-array",
  "react/no-clone-element",
  "react/no-comment-textnodes",
  "react/no-component-will-mount",
  "react/no-component-will-receive-props",
  "react/no-component-will-update",
  "react/no-create-ref",
  "react/no-direct-mutation-state",
  "react/no-duplicate-key",
  "react/no-implicit-key",
  "react/no-missing-key",
  "react/no-nested-components",
  "react/no-redundant-should-component-update",
  "react/no-set-state-in-component-did-mount",
  "react/no-set-state-in-component-did-update",
  "react/no-set-state-in-component-will-update",
  "react/no-string-refs",
  "react/no-unsafe-component-will-mount",
  "react/no-unsafe-component-will-receive-props",
  "react/no-unsafe-component-will-update",
  "react/no-unstable-context-value",
  "react/no-unstable-default-props",
  "react/no-unused-class-component-members",
  "react/no-unused-state",
  "react/no-useless-fragment",
  "react/prefer-destructuring-assignment",
  "react/prefer-shorthand-boolean",
  "react/prefer-shorthand-fragment",
  "react/no-leaked-conditional-rendering",
  "react-dom/no-dangerously-set-innerhtml",
  "react-dom/no-dangerously-set-innerhtml-with-children",
  "react-dom/no-find-dom-node",
  "react-dom/no-missing-button-type",
  "react-dom/no-missing-iframe-sandbox",
  "react-dom/no-namespace",
  "react-dom/no-render-return-value",
  "react-dom/no-script-url",
  "react-dom/no-unsafe-iframe-sandbox",
  "react-dom/no-unsafe-target-blank",
)

export default stableConfig
