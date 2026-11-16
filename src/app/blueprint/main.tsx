// The blueprint designer on its own page (blueprint.html; docs/blueprint/spec.md).
import { render } from "preact";
import "../styles.css";
import "./blueprint.css";
import { BlueprintApp } from "./App.tsx";
import { camera, sandbox } from "../state.ts";
import { current, selection } from "./store.ts";

// Test hook, as on the games' pages.
(window as unknown as { __msb: unknown }).__msb = {
  blueprint: () => current.value,
  selection: () => selection.value,
  sandbox: () => sandbox.value,
  camera: () => camera.value,
};

render(<BlueprintApp />, document.getElementById("root")!);
