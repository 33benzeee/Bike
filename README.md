# Wheelie Works

A 3D bike-life game that runs in the browser. Ride wheelie bikes, e-bikes and e-motos
through a city, hold wheelies on the balance point, chain tricks into combos, slice
through traffic and outrun the cops. Built with [three.js](https://threejs.org/) — no
build step, no downloaded assets (models, textures and sound are all generated in code).

![A no-hander wheelie on the Surron at golden hour](docs/screenshot.jpg)

## Play

Any static file server works:

```bash
npm start            # python3 -m http.server 8080
# then open http://localhost:8080
```

To put it online, push the repo to GitHub and enable **Settings → Pages → Deploy from a
branch** (root folder). It is a plain static site.

The game detects what you are playing on and sets itself up:

| Device | Controls | UI |
| --- | --- | --- |
| PC | Keyboard (or gamepad) | Full HUD, high graphics |
| Tablet | Touch, larger buttons (1.3×) | Medium graphics |
| Phone | Touch, landscape | Compact HUD, lighter graphics |

It also switches live — touch the screen and the touch controls appear, press a key and
they go away. Everything can be overridden in **Settings**.

## Controls

| Action | Keyboard | Touch | Gamepad |
| --- | --- | --- | --- |
| Throttle | `W` / `↑` | GAS (slide up for more) | RT |
| Brake (rear brake in a wheelie) | `S` / `↓` | BRAKE | LT |
| Steer | `A` `D` / `←` `→` | Left stick | Left stick |
| Lean back (pull up) | `Shift` / `Q` | Stick down | Stick back |
| Lean forward | `E` | Stick up | Stick forward |
| Bunny hop (hold, release) | `Space` | HOP | A |
| One-hander / no-hander / seat stander / foot drag | `1` `2` `3` `4` (or `J` `K` `L` `;`) | Trick buttons | X / Y / B / LB |
| Burnout mode on/off (motor bikes): then hold throttle, steer to spin | `B` | BURNOUT | — |
| Camera (chase, far, first person, handlebar) | `C` | CAM | RB |
| Reset to the road | `R` | RESET | Back |
| Pause, garage, mute, time of day | `P`, `G`, `M`, `T` | II | Start |

**Your first wheelie:** get rolling, hold throttle and lean back. Feather the throttle to
float in the green balance-point zone; tap the brake if it goes too far. Stopped against a
wall? Hold brake to paddle backwards.

## What's in it

- **Physics** — the bike and rider are a rigid body on two sprung wheels with tyre forces
  at the contact patches. Wheelies, stoppies, loop-outs, squat, dive, kerb hits and jumps
  all come out of the simulation rather than being scripted. Three assist levels: *Easy*
  (auto-balance), *Normal* (shaped throttle, still skill-based) and *Sim* (raw).
- **Eight bikes** — Wheelie Bike, Trail MTB, Macfox X1, Super73-RX, Surron Light Bee X,
  Talaria Sting R, E Ride Pro-SS and the Stark Varg, each with its own weight, geometry,
  power curve, balance point and temperament.
- **Tricks and combos** — wheelies, manuals, stoppies, hops, air, flips, swerves, skids,
  12 o'clock scrapes, traffic near-misses, plus four hold-to-pose variations that also work
  in the air (Superman, Can-Can…). Chain them before the timer runs out to bank cash.
- **City** — an 8×8-block island: downtown towers with alleys, a park with hills, a dirt
  jump park, a skate plaza, a construction site with container gaps, a civic plaza with
  stair sets, and the Wheelie Works shop. Traffic obeys lights; cars brake for you.
- **Cops** — patrols notice wheelies, speeding and e-motos. Five heat levels escalate from
  one cruiser to backup, roadblocks, bike cops that follow you through alleys, and a
  helicopter. Break line of sight and stay hidden to escape for a payout.
- **Progression** — cash from combos, escapes and 21 challenges buys bikes, four upgrade
  tracks per bike and paint. Progress saves in the browser.
- **Day, golden hour and night**, four camera modes, synthesised audio.

## Code map

| File | What it does |
| --- | --- |
| `src/main.js` | Game states and the main loop |
| `src/physics.js` | Bike dynamics, collisions, crashes |
| `src/bikes.js` | Bike specs, prices, upgrades, paint — tune the game here |
| `src/bikeModel.js`, `src/rider.js` | Procedural bike meshes; IK-posed rider and ragdoll |
| `src/world/` | City generator, terrain/colliders, sky and lighting |
| `src/traffic.js`, `src/cops.js` | Traffic and police AI |
| `src/tricks.js`, `src/progress.js` | Scoring, save data, challenges |
| `src/input.js`, `src/ui/` | Keyboard/gamepad/touch input, HUD, menus, touch controls |
| `src/audio.js`, `src/effects.js`, `src/camera.js` | Sound, particles, cameras |

Bike and brand names belong to their respective owners; this is an unaffiliated fan
project. three.js is MIT licensed (see `vendor/THREE-LICENSE`).
