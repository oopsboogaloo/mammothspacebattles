import { COMPONENTS, type ComponentDefinition, type PlacedComponent, calculateMassProperties, canPlace } from "./ship-designer";

const state: { selected: ComponentDefinition; components: PlacedComponent[]; message: string } = {
  selected: COMPONENTS[0],
  components: [],
  message: "Choose a component, then click the construction area to place it.",
};

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`The ship designer page is missing ${selector}.`);
  }
  return element;
}

function requireCanvasContext(canvasElement: HTMLCanvasElement): CanvasRenderingContext2D {
  const canvasContext = canvasElement.getContext("2d");
  if (!canvasContext) {
    throw new Error("Canvas rendering is not available.");
  }
  return canvasContext;
}

const palette = requireElement<HTMLDivElement>("#palette");
const canvas = requireElement<HTMLCanvasElement>("#designer");
const stats = requireElement<HTMLDivElement>("#stats");
const message = requireElement<HTMLParagraphElement>("#message");
const context = requireCanvasContext(canvas);

function renderPalette(): void {
  palette.replaceChildren(
    ...COMPONENTS.map((definition) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${definition.label} (${definition.dryMass} t)`;
      button.className = definition.kind === state.selected.kind ? "selected" : "";
      button.addEventListener("click", () => {
        state.selected = definition;
        render();
      });
      return button;
    }),
  );
}

function drawDesigner(): void {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#07111f";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(148, 163, 184, 0.2)";
  for (let x = 0; x < canvas.width; x += 20) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, canvas.height);
    context.stroke();
  }
  for (let y = 0; y < canvas.height; y += 20) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(canvas.width, y);
    context.stroke();
  }

  for (const component of state.components) {
    context.fillStyle = component.definition.color;
    context.fillRect(component.x, component.y, component.definition.width, component.definition.height);
    context.strokeStyle = "#0f172a";
    context.strokeRect(component.x, component.y, component.definition.width, component.definition.height);
    context.fillStyle = "#0f172a";
    context.font = "12px sans-serif";
    context.fillText(component.definition.label, component.x + 6, component.y + 18);
  }

  const massProperties = calculateMassProperties(state.components);
  if (massProperties.totalMass > 0) {
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(massProperties.centerOfMass.x, massProperties.centerOfMass.y, 5, 0, Math.PI * 2);
    context.fill();
  }
}

function renderStats(): void {
  const massProperties = calculateMassProperties(state.components);
  stats.textContent = `Mass: ${massProperties.totalMass.toFixed(1)} t | Center of mass: (${massProperties.centerOfMass.x.toFixed(1)}, ${massProperties.centerOfMass.y.toFixed(1)}) | Rotational inertia: ${massProperties.rotationalInertia.toFixed(1)}`;
  message.textContent = state.message;
}

function render(): void {
  renderPalette();
  drawDesigner();
  renderStats();
}

canvas.addEventListener("click", (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = Math.round((event.clientX - rect.left - state.selected.width / 2) / 10) * 10;
  const y = Math.round((event.clientY - rect.top - state.selected.height / 2) / 10) * 10;
  const candidate: PlacedComponent = {
    id: crypto.randomUUID(),
    definition: state.selected,
    x: Math.max(0, Math.min(canvas.width - state.selected.width, x)),
    y: Math.max(0, Math.min(canvas.height - state.selected.height, y)),
  };

  if (!canPlace(candidate, state.components)) {
    state.message = "Placement blocked: solid components cannot overlap.";
    render();
    return;
  }

  state.components.push(candidate);
  state.message = `Placed ${state.selected.label}.`;
  render();
});

render();
