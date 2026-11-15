# Moon Mammoth: game spec

A fast platform game built on the Mammoth Space Battles physics. You are a round, stylised woolly
mammoth (who may also happen to be an astronaut) running round the outside of a small moon against
the clock. The moon turns under you as you run, so the mammoth stays upright in the middle of the
screen.

Status: written 15 November 2026 from Chloe's spoken brief and her answers the same day (§9).
**Nothing is built.** Design and plan: `moon-mammoth-design.md`. The requirement IDs (MMN-…) are
this game's own.

**What this version is for.** Chloe, 15 November 2026: "This isn't a serious game… I mainly want
to get the engine and the build for mammoth movement in here." So the mammoth's movement (run,
turn, jump, roll, duck and slide, on the shared physics) is the point. The level is a simple one of
our own to exercise it. Moon Mammoth is one piece of something larger: later games have the
mammoth exploring more widely, and outside a station.

## 1. Decisions

| Question | Decision |
|---|---|
| Name | **Moon Mammoth**. |
| Character | A woolly mammoth: round and stylised. Not an astronaut who is a person. |
| Collision shape | One circle. Chloe: "I don't mind for collisions, that's a circle." |
| World | One large, roughly circular moon, with craters, rocks and ledges on its surface. |
| Gravity | Always towards the moon's centre, so you can run all the way round. |
| View | Follows the mammoth and turns with it, so the mammoth is always upright and the moon turns and moves under it. |
| Moves | Run left and right, turn, jump, roll, duck and slide. |
| Roll | A short burst of speed on its own button, to get out of the way of something (a rock starting to fall). |
| Duck | Standing still, the mammoth sits down. Moving, it slides, low enough to pass under something. |
| The game | A time trial. A timer counts down to the next checkpoint. Reach it in time and the next leg starts. Run out of time and you go straight back to the last checkpoint to try again. |
| Hazards | Craters with something sharp at the bottom. Rocks that start to fall as you come near. No enemies for now. |
| Falling | The mammoth can fall any distance unhurt, for now. |
| Lives | None. You can't lose the game: you only lose time. |
| Physics | The shared engine does the collisions and the gravity. The mammoth is a body in the world like any other. |
| Art | Placeholder SVG sprite sheets, laid out so real art can replace them without code changes. |
| Level | One level, designed by us. More, or Chloe's own drawings, later. |
| Controls | Keyboard, touch and gamepad. |
| Pace | Fast. A failed leg restarts at once, with no screen in between. |

## 2. Flow

1. **Title.** The name and Play, over the moon seen whole, slowly turning.
2. **Play.** The mammoth stands at the start flag. The clock starts when it first moves.
3. **Leg.** Reach the next flag before the timer runs out. The timer is then set for the next leg.
4. **Failed.** Out of time, on the spikes, or under a falling rock: the mammoth is put back at the
   last flag it reached, at rest, with that leg's full time. A short note says why ("TOO SLOW",
   "OUCH"). Play never stops.
5. **Finished.** The last flag: the run's whole time, the number of tries, and the best time on this
   device. Play again, or back to the title.

## 3. Rules

Sizes, speeds and times here are what the player sees. All are first values, to tune after play.

### The moon

- About 80 m in radius, so a lap is about 500 m: under a minute at a flat run.
- Gravity at the surface is about 25 m/s², towards the centre.
- The surface is rock that can't be damaged: gentle hills, craters, boulders, and ledges to jump
  up onto and drop off.
- Floating girders (station wreckage) hang low over the ground in places: too low to pass under
  standing, high enough to slide under.

### The mammoth

- A circle 2 m across standing, 1.2 m across ducked or sliding.
- **Run:** up to 9 m/s. It reaches full speed in about a quarter of a second and stops as quickly.
- **Turn:** changing direction on the ground plays a turn; the mammoth keeps moving meanwhile.
- **Jump:** about 3.5 m high with the button held, about 1.5 m with a tap. At a run it clears about
  9 m. It steers in the air, less sharply than on the ground. A jump pressed just before landing,
  or just after running off an edge, still counts.
- **Roll:** on the ground, the mammoth curls up and rolls the way it faces at 16 m/s for half a
  second, then comes out of it running. It can't be steered or stopped during the roll, and can't
  roll again for a second after. A jump during a roll carries the roll's speed, so a rolling jump
  goes further.
- **Duck:** held while still, the mammoth sits. Held while moving, it slides: it keeps its speed at
  first and slows steadily, and is low enough to pass under a girder. It stays down until there is
  room to stand, even if the button is let go.
- It slides on the rock rather than rolling like a ball: its legs and its roll are what move it.
- Nothing hurts it but the hazards below. It can fall any distance.

### Hazards

- **Spikes** at the bottom of some craters. Touching them sends the mammoth back to the last flag.
- **Falling rocks.** A boulder sits on a ledge or girder above the path. It starts to fall when the
  mammoth comes near. Hit by it while it is falling, the mammoth goes back to the last flag. Once
  the rock has come to rest it is only an obstacle. When the mammoth is sent back, the leg's rocks
  are back where they began.
- No enemies.

### Flags and the timer

- Flags stand round the moon in the order they must be reached. The level's first is the start
  and its last is the finish.
- Each leg has its own time. The timer shows what is left of it, counting down.
- Reaching a flag ends the leg: the timer is set to the next leg's time. Time left over is not
  carried forward.
- At zero the mammoth is put back at the last flag it reached.
- The run's whole time counts up from the first move to the finish, tries included. That is the
  score: lower is better.

## 4. Controls, HUD and view

| Move | Keyboard | Touch | Gamepad |
|---|---|---|---|
| Left, right | ← → or A D | two buttons, bottom left | stick or D-pad |
| Jump | Space, ↑ or W | large button, bottom right | A |
| Duck and slide | ↓ or S | button beside Jump | B, or stick or D-pad down |
| Roll | Shift, or X | button above Jump | X, or the right bumper or trigger |
| Pause | P or Esc | Pause in the HUD | Start |

- **HUD:** the leg's timer (large, red in its last 3 seconds), the flag reached out of how many,
  the run's whole time, and tries.
- **View:** the mammoth a little below the middle of the screen, upright. The moon's surface curves
  away to both sides. Stars behind, turning with the moon. The view doesn't bob with every jump: it
  follows the ground's height, and the mammoth rises within it.

## 5. Look

- Placeholder art: flat, simple shapes.
- The mammoth: round brown woolly body, a domed head, trunk, two tusks, small ears, four stubby
  legs, and a glass helmet.
- Its animations, each a row of the sprite sheet: idle, walk, turn, jump (up, top, down), roll,
  sit, slide.
- The moon: pale grey rock with a lighter rim and darker craters. Spikes red and white. Girders
  metal. Flags: grey once reached, yellow for the next, chequered for the finish.
- No sound in this version.

## 6. Requirements

| ID | Requirement |
|---|---|
| MMN-001 | The game has its own page with a title and Play, and nothing that leads to the sandbox. |
| MMN-002 | The mammoth is one disc in the world, moved only by gravity, contacts and its own moves. |
| MMN-003 | Gravity pulls the mammoth towards the moon's centre everywhere on the surface: it can run the whole way round, either way. |
| MMN-010 | Run: held left or right, the mammoth reaches its run speed along the ground and no more; let go, it stops. |
| MMN-011 | The mammoth doesn't climb a face steeper than 60°: it must jump it. |
| MMN-012 | Turn: reversing on the ground changes the way it faces and plays the turn. |
| MMN-020 | Jump: from the ground it leaves at the jump speed, away from the moon's centre. Not from the air. |
| MMN-021 | A jump let go while rising is cut short. |
| MMN-022 | A jump pressed up to 0.1 s before landing, or up to 0.1 s after leaving an edge, is made. |
| MMN-023 | In the air it can be steered, at a lower acceleration than on the ground. |
| MMN-030 | Roll: on the ground, a burst at the roll speed in the direction faced, for a set time, unsteered. |
| MMN-031 | It can't roll again until the wait after a roll has passed. |
| MMN-032 | A jump during a roll keeps the roll's speed along the ground. |
| MMN-040 | Duck: the disc is its ducked size while ducked. Still, the mammoth sits and doesn't move. |
| MMN-041 | Slide: ducked while moving, it keeps moving and slows at the slide's rate. |
| MMN-042 | It passes under a gap lower than its standing height and higher than its ducked height only ducked. |
| MMN-043 | It doesn't stand up where there isn't room, whatever the button. |
| MMN-050 | Flags are reached in order. Reaching the next sets the timer to the next leg's time. |
| MMN-051 | The timer at zero puts the mammoth back at the last flag reached, at rest, with the leg's full time. |
| MMN-052 | Touching spikes does the same. |
| MMN-053 | A rock starts to fall when the mammoth first comes within its distance. Touching it while it falls sends the mammoth back. At rest it is an obstacle. |
| MMN-054 | When the mammoth is sent back, the leg's rocks are put back. |
| MMN-055 | The last flag ends the run: its whole time and tries are shown, and the best time is kept on the device. |
| MMN-056 | The clock starts at the first move. |
| MMN-060 | The view turns so the mammoth is upright, and follows it round the moon. |
| MMN-061 | The mammoth is drawn from a sprite sheet: the row by what it is doing, flipped by the way it faces. |
| MMN-062 | Replacing the sprite sheet file with one of the same layout changes the art and nothing else. |
| MMN-070 | Keyboard, touch and gamepad each make every move. |
| MMN-071 | Pause stops the world and the clocks. |
| MMN-080 | A run and its replay from the same inputs agree exactly (the game is in the world, as the other games'). |
| MMN-081 | The mammoth's moves break none of the engine's conservation checks: what its legs add is recorded. |

## 7. Engine changes

Small, and each optional (off unless a scenario asks). Detail in `moon-mammoth-design.md` §2.

1. **The mammoth's movement**, a new part of the world (`world.moon`): the moves above.
2. **Rock that doesn't bounce**: the ground's rock can be given its own bounciness. Today it has
   the default (0.5), and a contact takes the bouncier of the two bodies, so the mammoth would
   bounce off every landing.
3. **A view that turns** with a body. Level 7 of Mammoth Thrust already turns the drawing; this
   turns it by the mammoth's place on the moon.

Gravity towards a body (FLT-015), rock from an outline with islands (TER-007) and disc contacts
are there already.

## 8. Not in this version

Enemies. Fall damage. Sound. More than one level. Collecting things. Scores other than time.
Damage to the rock. Moving platforms. The station.

## 9. Answered (15 November 2026)

| Question | Chloe's answer |
|---|---|
| The character? | "The character's a mammoth. The mammoth might happen to be an astronaut as well, but he's a mammoth. A woolly mammoth: round, stylised." |
| The name? | "Moon Mammoth is the game." |
| Gravity towards the centre, with the camera turning to keep the player upright? | Yes. |
| Ways to fail besides the timer? | "Let's include some craters with something sharp at the bottom. No enemies for now. And for now, let's let the mammoth fall any distance." |
| Who designs the level? | "Design the first level yourself. This isn't a serious game… I mainly want to get the engine and the build for mammoth movement in here." |
| Roll and duck? | "Roll is a temporary speed-up that you can use just to get out of the way of something… maybe you can have some things start to fall, and if you press the roll, you get out of the way. And duck lets you slide and duck under something." |
| Controls? | "Keyboard, touch and gamepad is perfect." |

## 10. Open questions

Each has what the design assumes until Chloe says otherwise.

1. **Time left over** at a flag: dropped (assumed), or added to the next leg?
2. **What you slide under:** floating girders (assumed). A moon has nothing else that hangs.
3. **Rolling in the air:** not allowed to start (assumed); a roll begun on the ground carries into
   a jump.
4. **Does the roll hurt anything?** No (assumed): it is only speed.
5. **The speeds and sizes in §3:** first values. Chloe tunes after playing.
6. **Direction of the course:** to the right, clockwise round the moon (assumed).
