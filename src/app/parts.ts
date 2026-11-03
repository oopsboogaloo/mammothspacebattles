// Built-in ship parts (M4, W3): a hull, a propellant tank, and an engine assembly whose
// geometry matches RS-08 (scenarios/rs08-chemical-rocket.json). No DOM.
import type { BodyInput } from "../core/index.ts";
import type { Prefab } from "./ports.ts";

/** A prefab with the body that welds onto whatever it is attached to. */
export interface MountedPrefab extends Prefab {
  mount: string;
}

export const HULL: Omit<BodyInput, "id" | "position" | "velocity"> = {
  shape: {
    kind: "box",
    width: 1.2,
    height: 1.0,
  },
  mass: 8.0,
  angle: 0,
  angularVelocity: 0,
  restitution: 0,
  friction: 0.3,
};

export const TANK: Omit<BodyInput, "id" | "position" | "velocity"> = {
  shape: {
    kind: "box",
    width: 1.0,
    height: 0.5,
  },
  mass: 2.0,
  angle: 0,
  angularVelocity: 0,
  restitution: 0,
  friction: 0.3,
  contents: [
    {
      resource: "h2",
      mass: 0.2,
      capacity: 0.2,
    },
    {
      resource: "o2",
      mass: 1.6,
      capacity: 1.6,
    },
  ],
};

/** Chamber, throat and flared nozzle around an injector head ("engine"), which is the mount. Exhaust leaves along −y. */
export const ENGINE: MountedPrefab = {
  name: "Engine",
  mount: "engine",
  bodies: [
    {
      id: "engine",
      shape: {
        kind: "box",
        width: 1.0,
        height: 0.2,
      },
      mass: 1.0,
      position: {
        x: 0,
        y: 0.0,
      },
      velocity: {
        x: 0,
        y: 0,
      },
      angle: 0,
      angularVelocity: 0,
      restitution: 0,
      friction: 0.3,
      contents: [
        {
          resource: "h2",
          mass: 0,
          capacity: 0.01,
        },
        {
          resource: "o2",
          mass: 0,
          capacity: 0.08,
        },
      ],
      injector: {
        channel: "main",
        rate: 0.5,
        mixture: {
          h2: 0.1111111111111111,
          o2: 0.8888888888888888,
        },
        outlet: {
          x: 0,
          y: -0.15,
        },
        direction: {
          x: 0,
          y: -1,
        },
        width: 0.6,
        speed: 10,
        parcelMass: 0.001,
        radius: 0.035,
        igniter: true,
      },
    },
    {
      id: "chamber-left",
      shape: {
        kind: "box",
        width: 0.1,
        height: 0.8,
      },
      mass: 0.5,
      position: {
        x: -0.45,
        y: -0.5,
      },
      velocity: {
        x: 0,
        y: 0,
      },
      angle: 0,
      angularVelocity: 0,
      restitution: 0,
      friction: 0.3,
    },
    {
      id: "chamber-right",
      shape: {
        kind: "box",
        width: 0.1,
        height: 0.8,
      },
      mass: 0.5,
      position: {
        x: 0.45,
        y: -0.5,
      },
      velocity: {
        x: 0,
        y: 0,
      },
      angle: 0,
      angularVelocity: 0,
      restitution: 0,
      friction: 0.3,
    },
    {
      id: "throat-left",
      shape: {
        kind: "box",
        width: 0.35,
        height: 0.1,
      },
      mass: 0.3,
      position: {
        x: -0.325,
        y: -0.95,
      },
      velocity: {
        x: 0,
        y: 0,
      },
      angle: 0,
      angularVelocity: 0,
      restitution: 0,
      friction: 0.3,
    },
    {
      id: "throat-right",
      shape: {
        kind: "box",
        width: 0.35,
        height: 0.1,
      },
      mass: 0.3,
      position: {
        x: 0.325,
        y: -0.95,
      },
      velocity: {
        x: 0,
        y: 0,
      },
      angle: 0,
      angularVelocity: 0,
      restitution: 0,
      friction: 0.3,
    },
    {
      id: "nozzle-left",
      shape: {
        kind: "polygon",
        vertices: [
          {
            x: 0.175,
            y: 0.3,
          },
          {
            x: 0.095,
            y: 0.3,
          },
          {
            x: -0.175,
            y: -0.3,
          },
          {
            x: -0.095,
            y: -0.3,
          },
        ],
      },
      mass: 0.3,
      position: {
        x: -0.325,
        y: -1.3,
      },
      velocity: {
        x: 0,
        y: 0,
      },
      angle: 0,
      angularVelocity: 0,
      restitution: 0,
      friction: 0.3,
    },
    {
      id: "nozzle-right",
      shape: {
        kind: "polygon",
        vertices: [
          {
            x: -0.175,
            y: 0.3,
          },
          {
            x: 0.095,
            y: -0.3,
          },
          {
            x: 0.175,
            y: -0.3,
          },
          {
            x: -0.095,
            y: 0.3,
          },
        ],
      },
      mass: 0.3,
      position: {
        x: 0.325,
        y: -1.3,
      },
      velocity: {
        x: 0,
        y: 0,
      },
      angle: 0,
      angularVelocity: 0,
      restitution: 0,
      friction: 0.3,
    },
  ],
  joints: [
    {
      id: "w-head-left",
      a: "engine",
      b: "chamber-left",
      anchorA: {
        x: -0.45,
        y: -0.1,
      },
      anchorB: {
        x: 0.0,
        y: 0.4,
      },
    },
    {
      id: "w-head-right",
      a: "engine",
      b: "chamber-right",
      anchorA: {
        x: 0.45,
        y: -0.1,
      },
      anchorB: {
        x: 0.0,
        y: 0.4,
      },
    },
    {
      id: "w-left-throat",
      a: "chamber-left",
      b: "throat-left",
      anchorA: {
        x: 0.0,
        y: -0.4,
      },
      anchorB: {
        x: -0.125,
        y: 0.05,
      },
    },
    {
      id: "w-right-throat",
      a: "chamber-right",
      b: "throat-right",
      anchorA: {
        x: 0.0,
        y: -0.4,
      },
      anchorB: {
        x: 0.125,
        y: 0.05,
      },
    },
    {
      id: "w-throat-nozzle-left",
      a: "throat-left",
      b: "nozzle-left",
      anchorA: {
        x: 0.135,
        y: -0.05,
      },
      anchorB: {
        x: 0.135,
        y: 0.3,
      },
    },
    {
      id: "w-throat-nozzle-right",
      a: "throat-right",
      b: "nozzle-right",
      anchorA: {
        x: -0.135,
        y: -0.05,
      },
      anchorB: {
        x: -0.135,
        y: 0.3,
      },
    },
  ],
};
