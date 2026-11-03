// Sandbox UI entry point.
import { render } from "preact";
import { useEffect } from "preact/hooks";
import "./styles.css";
import { CommandPalette, ContextMenu, Dialog, Picker, ProbeMenu, Shortcuts, Toast, ViolationsPopover } from "./Overlays.tsx";
import { Drawer, Inspector, MobileBar, SpawnPalette, StatusBar, ToolRail, TopBar } from "./Panels.tsx";
import {
  action,
  camera,
  cmdkOpen,
  contextMenu,
  dialog,
  keyToAction,
  persist,
  probeMenu,
  sandbox,
  screen,
  sheet,
  shortcutsOpen,
  tool,
  violationsOpen,
} from "./state.ts";
import { View } from "./View.tsx";
import { toScreen } from "./camera.ts";
import { hashValue } from "../core/index.ts";

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

function App() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || dialog.value || shortcutsOpen.value || violationsOpen.value) {
        if (e.key === "Escape") {
          dialog.value = null;
          shortcutsOpen.value = false;
          violationsOpen.value = false;
        }
        return;
      }
      if (cmdkOpen.value) return;
      const id = keyToAction(e);
      if (!id) return;
      // Space always means play/pause (Enter still activates a focused button).
      const a = action(id);
      if (a.enabled && !a.enabled()) return;
      e.preventDefault();
      a.run();
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      persist();
      if (sandbox.value?.dirty) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);

  return (
    <>
      {screen.value === "picker" || !sandbox.value ? (
        <Picker />
      ) : (
        <div class="app" data-testid="sandbox">
          <TopBar />
          <div class="body">
            <ToolRail />
            {tool.value === "spawn" && <SpawnPalette />}
            <div class="center">
              <View />
              <Drawer />
            </div>
            <Inspector />
          </div>
          <StatusBar />
          <MobileBar />
          {sheet.value && (
            <div class="sheet" role="dialog" aria-label={sheet.value === "graphs" ? "Graphs" : "Inspector"}>
              <button class="btn ghost" onClick={() => (sheet.value = null)}>
                Close
              </button>
              {sheet.value === "inspector" ? <Inspector /> : <Drawer />}
            </div>
          )}
        </div>
      )}
      {cmdkOpen.value && <CommandPalette />}
      {shortcutsOpen.value && <Shortcuts />}
      {contextMenu.value && sandbox.value && <ContextMenu />}
      {probeMenu.value && sandbox.value && <ProbeMenu />}
      {violationsOpen.value && sandbox.value && <ViolationsPopover />}
      {dialog.value && <Dialog />}
      <Toast />
    </>
  );
}

// Test and debugging hook: map world points to page pixels and inspect the live world.
(window as unknown as { __msb: unknown }).__msb = {
  sandbox: () => sandbox.value,
  toPage: (x: number, y: number) => {
    const view = document.querySelector('[data-testid="view"]')!.getBoundingClientRect();
    const s = toScreen(camera.value, { width: view.width, height: view.height }, { x, y });
    return { x: view.left + s.x, y: view.top + s.y };
  },
  hash: () => (sandbox.value ? hashValue(sandbox.value.world) : null),
};

render(<App />, document.getElementById("root")!);
