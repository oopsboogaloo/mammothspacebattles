// Sandbox UI entry point.
import { render } from "preact";
import { useEffect } from "preact/hooks";
import "./styles.css";
import { CommandPalette, ContextMenu, Dialog, Picker, ProbeMenu, Shortcuts, Toast, ViolationsPopover } from "./Overlays.tsx";
import { Drawer, GasPalette, Inspector, MobileBar, SpawnPalette, StatusBar, ToolRail, TopBar } from "./Panels.tsx";
import {
  action,
  bindingFor,
  bindings,
  edit,
  showToast,
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
import { sim, View } from "./View.tsx";
import { gameKeyDown, gameKeyUp, LanderApp } from "./Lander.tsx";
import { toScreen } from "./camera.ts";
import { hashValue } from "../core/index.ts";
import { shown } from "./smooth.ts";

const pressGroups: Record<string, number> = {};
let pressCounter = 5_000_000;

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
      // In the game only its keys work (Lander.tsx, shared with the game's own page).
      if (screen.value === "lander") {
        gameKeyDown(e);
        return;
      }
      const key = e.key.toLowerCase();
      if (bindingFor.value && !e.ctrlKey && !e.metaKey && key.length === 1) {
        // Capture this key for the channel waiting to be bound (SBX-020).
        e.preventDefault();
        const channel = bindingFor.value;
        bindings.value = { ...Object.fromEntries(Object.entries(bindings.value).filter(([, c]) => c !== channel)), [key]: channel };
        bindingFor.value = null;
        persist();
        showToast(`${key.toUpperCase()} now drives "${channel}". Bound keys take priority over tool shortcuts.`);
        return;
      }
      const channel = bindings.value[key];
      if (channel && sandbox.value && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (!e.repeat) {
          pressGroups[key] = ++pressCounter;
          edit([{ type: "control.set", channel, value: 1 }], `Key ${key.toUpperCase()}`, pressGroups[key]);
        }
        return;
      }
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
      if (sandbox.value?.dirty && screen.value !== "lander") e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (screen.value === "lander") {
        gameKeyUp(e);
        return;
      }
      const key = e.key.toLowerCase();
      const channel = bindings.value[key];
      if (channel && sandbox.value && pressGroups[key] !== undefined) {
        edit([{ type: "control.set", channel, value: 0 }], `Key ${key.toUpperCase()}`, pressGroups[key]);
        delete pressGroups[key];
      }
    };
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);

  return (
    <>
      {screen.value === "lander" ? (
        <LanderApp />
      ) : screen.value === "picker" || !sandbox.value ? (
        <Picker />
      ) : (
        <div class="app" data-testid="sandbox">
          <TopBar />
          <div class="body">
            <ToolRail />
            {(tool.value === "spawn" || tool.value === "attach") && <SpawnPalette />}
            {tool.value === "gas" && <GasPalette />}
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
  /** The simulation worker: whether there is one, runs of steps it has delivered, and gas jobs its helpers ran. */
  /** The game time drawn on screen: the latest world's, moved on for smooth motion (smooth.ts). */
  shown: () => shown.time,
  sim: () => ({ worker: sim.available, runs: sim.runs, helperJobs: sim.helperJobs }),
};

render(<App />, document.getElementById("root")!);
