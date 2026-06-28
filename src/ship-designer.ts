export type ComponentKind = "cockpit" | "fuel" | "thruster" | "armor";

export interface ComponentDefinition {
  readonly kind: ComponentKind;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly dryMass: number;
  readonly color: string;
}

export interface PlacedComponent {
  readonly id: string;
  readonly definition: ComponentDefinition;
  readonly x: number;
  readonly y: number;
}

export interface MassProperties {
  readonly totalMass: number;
  readonly centerOfMass: { readonly x: number; readonly y: number };
  readonly rotationalInertia: number;
}

export const COMPONENTS: readonly ComponentDefinition[] = [
  { kind: "cockpit", label: "Cockpit", width: 70, height: 50, dryMass: 8, color: "#6ee7f9" },
  { kind: "fuel", label: "Fuel tank", width: 60, height: 60, dryMass: 12, color: "#fbbf24" },
  { kind: "thruster", label: "Thruster", width: 45, height: 55, dryMass: 6, color: "#f87171" },
  { kind: "armor", label: "Armor plate", width: 80, height: 25, dryMass: 10, color: "#94a3b8" },
];

export function overlaps(a: PlacedComponent, b: PlacedComponent): boolean {
  return !(
    a.x + a.definition.width <= b.x ||
    b.x + b.definition.width <= a.x ||
    a.y + a.definition.height <= b.y ||
    b.y + b.definition.height <= a.y
  );
}

export function canPlace(candidate: PlacedComponent, components: readonly PlacedComponent[]): boolean {
  return components.every((component) => !overlaps(candidate, component));
}

export function calculateMassProperties(components: readonly PlacedComponent[]): MassProperties {
  const totalMass = components.reduce((sum, component) => sum + component.definition.dryMass, 0);

  if (totalMass === 0) {
    return { totalMass: 0, centerOfMass: { x: 0, y: 0 }, rotationalInertia: 0 };
  }

  const weighted = components.reduce(
    (sum, component) => {
      const centerX = component.x + component.definition.width / 2;
      const centerY = component.y + component.definition.height / 2;
      return {
        x: sum.x + centerX * component.definition.dryMass,
        y: sum.y + centerY * component.definition.dryMass,
      };
    },
    { x: 0, y: 0 },
  );
  const centerOfMass = { x: weighted.x / totalMass, y: weighted.y / totalMass };

  const rotationalInertia = components.reduce((sum, component) => {
    const mass = component.definition.dryMass;
    const localInertia = (mass * (component.definition.width ** 2 + component.definition.height ** 2)) / 12;
    const centerX = component.x + component.definition.width / 2;
    const centerY = component.y + component.definition.height / 2;
    const dx = centerX - centerOfMass.x;
    const dy = centerY - centerOfMass.y;
    return sum + localInertia + mass * (dx ** 2 + dy ** 2);
  }, 0);

  return { totalMass, centerOfMass, rotationalInertia };
}
