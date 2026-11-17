# How to describe things to Claude (3D, animation, camera)

A cheat sheet for talking about what you see and what you want, in words. None of this is required: your sketches and plain descriptions already work well. This is just the vocabulary that makes a request unambiguous, so there are fewer rounds of "not quite".

The most useful habit, above any single word: **say what you see, say what you want instead, and say how much.** For example: "the fish cluster is too tight at the top (what I see); I want the heads spread out more along each rib (what I want); step 1 only, by about half (how much)."

---

## 1. Animation: yes, talk in curves

Your instinct is right. "Curve" is the best single metaphor, because it is exactly how the code works: every animated thing has a value (a position, an angle, a size, a speed) that changes over time, and the **shape of that change** is the curve. Describing the shape is far more precise than saying "faster" or "smoother".

You already did this well with the fish surfacing: *"slow to fast to slow again, the first slow about 10% of the animation, the fast about 70%, the final slow the remaining 20%, all smoothed."* That is a complete description: it gave the **shape** (slow, fast, slow), the **proportions** (10 / 70 / 20), and the **quality** (smoothed). I could build it with no guessing.

### The four things to say about any movement

1. **What moves.** The hook, the camera, the rod, the cone of fish.
2. **From where to where.** "From 2 units under the water to 4 units above it."
3. **How long.** In seconds, or as a percentage of some other animation ("the whole thing lasts about a second").
4. **The shape of the speed.** Use the words below.

### Speed-shape words (easing)

| Say this | What it means | Picture of speed over time |
|---|---|---|
| **Linear** / constant speed | Same speed the whole way. Feels mechanical. | a flat line |
| **Ease in** / accelerate / "start slow" | Starts slow, ends fast. Things that are *leaving* or *falling*. | speed climbs |
| **Ease out** / decelerate / "settle" / "land softly" | Starts fast, ends slow. Things that are *arriving*. | speed falls |
| **Ease in-out** / "smooth" / S-curve | Slow, fast, slow. What most natural motion looks like. | a hill |
| **Snappy** | Mostly fast, with a very short ease at the end | a hill with a sharp rise |
| **Floaty** / **heavy** | Floaty = long, gentle easing. Heavy = quick start, hard stop | |
| **Overshoot** | Goes past the target, then comes back to it | |
| **Bounce** | Hits the target, rebounds, settles after a few smaller bounces | |
| **Anticipation** | A small move the *opposite* way first (the rod winds back before the cast) | |
| **Follow-through** / **settle** | Keeps moving a little after the main motion stops (the rod springing, the hook swaying) | |
| **Damped oscillation** / "wobble then settle" | Swings back and forth, each swing smaller | |

Two more that matter a lot:

- **Smoothed** means no sudden steps in speed. If something looks "jagged" or "jerky", say so: it usually means the speed changes abruptly and needs easing.
- **Continuous** means a new motion starts at the speed the old one ended at (no jolt). I did this at the start of the surfacing animation so the hook doesn't lurch.

### Describing a curve by its shape or its numbers

Any of these works, from easiest to most exact:

- **By feel:** "slow, then a burst, then settle gently."
- **By proportions:** "10% slow, 70% fast, 20% slow" (as you did).
- **By speed multiples:** "the fast part is about 3x the normal reel speed."
- **By a sketch:** draw speed on the vertical, time on the horizontal. A hill, a ramp, a staircase. I read these well.

### Time words

- **Duration**: how long the whole animation takes. "About a second."
- **Delay**: wait before starting. "Start the splash a beat after the hook reaches the water."
- **A beat**: roughly a quarter to half a second. Handy and I will treat it as that.
- **At the same moment** vs **one after another** vs **overlapping**: say which. "Fade out while the camera pans" is overlapping.
- **Loop** / **once** / **ping-pong** (forward then back, repeating).
- **Triggered by**: what starts it. "The moment the hook crosses the finish line." Events are better than clock times when the thing depends on gameplay.

### Frequency and amount

"A little", "a lot" are fine, but a **number or a comparison** is better: "10% smaller", "twice as far", "half as often", "about 60% of the current speed." Comparing to the **current** value ("20% faster than now") is the easiest, because I know the current value.

---

## 2. The 3D space: axes, directions, units

### The three axes

In this project every 3D scene uses the same convention:

| Axis | Direction | Plain words |
|---|---|---|
| **x** | left / right | sideways |
| **y** | up / down | height. **Up is positive.** |
| **z** | toward you / away from you | depth |

A useful rule: **x is across, y is up, z is in/out.**

What "forward" means depends on the camera, which is the part that trips people up, so it is spelled out for each game below. When you are not sure, **describe from the camera's point of view** ("on the left of the screen", "further from the camera") and I will convert.

### Units

One **unit** is just the game's own measuring step. It is not metres. Things are sized relative to each other: a skater is about 1 unit across, a fish 1.3 to 2.6 units long, a fishing lane 9 units wide. So the best way to describe size is **relative**: "the hook should be half as big as a fish", "make the lane a bit wider."

### Fishing: the world, concretely

Imagine standing on the pier, facing the sea:

- **x** runs along the pier, **left to right**. Lane 1 (leftmost player) is the smallest x. Lanes are 9 units wide, side by side.
- **y** is up. **The water's surface is y = 0**, the seabed is far below (negative y). The finish line ("0 m") is 2 units under the surface, so y = -2.
- **z** is toward and away from the sea. **You stand on the pier at the high end of z. The sea is in the negative-z direction.** So "away from the pier, out to sea" is **-z**, and "toward the pier / toward the camera when you stand on it" is **+z**.
- The **pier** is a strip of planks close to you. Its front edge (with the railing) is at z = 6.
- The **play area** (the flat plane where hooks and fish live, the "2D game" part) is at z = -9: about **15 units out from the pier's front edge**, a bit more from where you stand. You can think of it as a giant vertical glass pane the hooks slide along.

So in the words you have been using: "the pier and the play area on two different planes" means two different z positions, with the play area further out (more negative z).

### Snowball and Penguin Lasso

These are on the ground, seen from above-and-behind. The convention there: **x = east (right on screen), z = south (toward the bottom of the screen), y = up.** The camera looks north. So "up the screen" is **-z**, not +y. This is the main thing to watch: on those two games *y is height off the floor*, not "up the screen".

### Words for where things are

Use whichever feels natural; all of these are understood:

- **Relative to the screen:** left, right, top, bottom, upper-left, "a third of the way down", "dead centre".
- **Relative to the camera:** closer to the camera, further from the camera, in front of, behind, "in the foreground / background".
- **Relative to something in the scene:** "just above the hook", "a unit to the right of the weight", "right behind the play area".
- **By axis:** "move it +x" or "raise it 2 units on y". Fine if you like it, never required.
- **Rotations:** see the next section.

---

## 3. Rotation and orientation

Three rotations, named by what they do to a thing like a head or a camera:

| Word | Rotation | Picture |
|---|---|---|
| **Yaw** | turn left/right around the up axis | shaking your head "no" |
| **Pitch** | tilt up/down | nodding "yes" |
| **Roll** | tilt sideways | leaning your head to your shoulder |

For a **rod**, a **camera**, or a **fish**: "pitch the rod up 30 degrees", "yaw it 20 degrees to the left", "the fish should roll onto its side."

Other useful orientation words:

- **Head up / head down / nose-down**: which end points where. "Head up at the hook" (the fish on the hook).
- **Facing**: the direction the front points. "Facing the camera", "facing away", "facing right".
- **Pivot / hinge point**: the spot something rotates around. "The rod pivots at the grip." Very worth saying, because a thing rotating around its middle looks very different from one rotating around its end.
- **Tilt / lean / droop / sag**: informal, all fine: "lean away from the way the hook is moving."
- **Fan / cone / ribs / radiate**: how things spread out from a point (the fish on the hook).
- **Trailing / dragging behind**: parts that lag behind the motion.

Degrees are easiest ("about 30 degrees"). "A little / a lot" is fine for rough ones.

---

## 4. The camera

Cameras are the hardest thing to describe and the easiest to get wrong, so use these words:

- **Position vs. target (where it is vs. what it looks at).** "Camera high above the pier looking straight down."
- **Shot types:** **close-up**, **medium**, **wide**, **establishing shot** (the opening that shows where we are), **overhead / bird's-eye**, **eye-level**, **low angle** (looking up), **high angle** (looking down), **first-person / POV** (as if through someone's eyes, like the pier opening).
- **Moves:**
  - **Pan**: rotate the camera left/right *without moving it* (what you asked for with the surface: "pan to the surface").
  - **Tilt**: rotate up/down without moving.
  - **Dolly**: move the camera forward/back through space. **Truck**: move it sideways. **Pedestal**: move it up/down. (Often just "move closer / pull back".)
  - **Zoom**: change the lens without moving (things get bigger, but perspective does not change). Different from dollying in, which changes how the depth looks.
  - **Follow / track**: stay with a moving subject.
  - **Cut**: instant switch from one camera view to another, no travel between. Usually with a **flash / fade / wipe** over it.
  - **Dissolve / crossfade**: one view melts into the next.
- **Field of view (FOV)**: how wide the lens sees. **Wide** = a lot in view and things look further apart and stretched near the edges. **Narrow / telephoto** = zoomed in and flat. "Make it feel more cramped" often means a wider FOV from closer.
- **Framing**: where the subject sits in the picture. "Hook in the lower third", "leave more room above". The **rule of thirds** (splitting the screen into 3 x 3) is a good shorthand for it.
- **Camera that follows vs. world that moves**: in the fishing game the camera really rises, but you described it as "move the whole ocean layer under a fixed hook". Both look identical, so describe whichever is clearer to *you*; I will pick the simpler build.

---

## 5. Objects, shapes and looks

- **Primitive shapes:** sphere, cube/box, cylinder, cone, disc, ring/torus, plane (a flat sheet), capsule. Building things from these is how most of the models here are made. "Make the weight a sphere", "the rod is a long thin cone that bends."
- **Silhouette**: the outline. "Keep the silhouette recognisable" is a great note when you are redesigning a model.
- **Proportions**: relative sizes of parts. "Head bigger than the body", "longer tail."
- **Low-poly / faceted / flat-shaded**: visibly flat faces, a chunky look. **Smooth-shaded**: no visible facets. The fish and rocks are low-poly.
- **Billboard / sprite**: a flat picture that always faces the camera (the name tags, the sparks).
- **Particles**: lots of tiny things at once, spawned and fading (splash, bubbles, snow, sparks).
- **Layers / depth order**: what covers what. "Names on top of everything" (they are on their own top layer).
- **Opacity / transparency**, **glow**, **blur**, **shadow**: say how strong ("30% see-through").
- **Color**: names are fine ("water blue"), hex codes are exact, and "the same color as X" is the easiest.

---

## 6. Gameplay and "feel" words

- **Responsive** (reacts instantly) vs **sluggish / floaty / laggy**.
- **Slippery** (keeps gliding) vs **grippy** (stops when you let go). The skating game is slippery on purpose.
- **Snappy**, **weighty**, **springy**.
- **Juice** (also: **game feel**, **polish**): the extra feedback that makes an action feel good: a bounce, a flash, a sound, a screen shake, a splash. "Add more juice to the catch" is a perfectly good request.
- **Readability**: can the player instantly tell what is happening? "The cluster is hard to read at 40 fish."
- **Tuning values** (speed, size, distance, count): these live as named numbers in the code. Saying "tune the X down 30%" is usually a one-line change. You can ask me "what are the tuning values for this?" and I will list them.

---

## 7. How to ask: patterns that work well

**Describe, compare, quantify.**
- Weak: "the splash needs to be better."
- Good: "the splash is too small and flat. I want it to fan up and out, bigger the more fish are on the hook, in water colors."

**Name the thing and the moment.** "The cluster of fish on the hook, *while the hook is rising*" beats "the fish."

**Say what to leave alone.** "Step 0 is perfect, only change step 1" saved a lot of risk. Also "do not make changes yet" when you want to talk first (I follow it).

**Anchor to something that exists.** "Like the sparks in the tap game, but water-coloured." "The same lean as before, but half as much."

**Use a sketch when words are awkward.** Your hand-drawn ones have been excellent: a bird's-eye plan, a side view, a front view. Labelling the **viewpoint** ("this is a bird's-eye view", "this is the front and side view") is the single most useful thing, as you have been doing.

**Give the reason when you have one.** "So that it looks like the hook is cast forward" lets me pick the right fix, not just the literal one.

**It is fine to ask for options.** "Show me three versions of the cone spread" or "what are the ways we could do this?" is quick and usually saves a round.

**Ask for a look.** I can build a throwaway test page, run it, and see it, then tell you what I saw (like the 1 / 3 / 15 fish test). If a request is visual, "check it looks right" is worth saying.

**One thing at a time is easier to verify, but several is fine.** Numbered lists work well when you have a few changes.

---

## 8. Quick glossary (A to Z)

| Term | Meaning |
|---|---|
| **Anticipation** | A small opposite move before the main one (winding back before a cast). |
| **Axis** | One of the three directions: x (across), y (up), z (in/out). |
| **Beat** | About a quarter to half a second of pause. |
| **Billboard** | A flat picture that always faces the camera. |
| **Bird's-eye** | Looking straight down from above. |
| **Cut** | An instant switch between camera views. |
| **Damped** | A wobble that dies away. |
| **Dolly** | Move the camera forward/back. |
| **Duration** | How long an animation takes. |
| **Ease in / out / in-out** | Slow start / slow end / both. |
| **Easing** | The shape of an animation's speed. |
| **FOV** | How wide the camera lens sees. |
| **Follow-through** | Motion that carries on after the main move stops. |
| **Framing** | Where things sit on the screen. |
| **Jagged / jerky** | Speed changes abruptly; needs smoothing. |
| **Juice** | Extra feedback that makes actions feel good. |
| **Layer** | A group drawn in a set order (names are on the top layer). |
| **Linear** | Constant speed. |
| **Low-poly** | Chunky, visibly faceted 3D look. |
| **Overshoot** | Goes past the target then returns. |
| **Pan** | Rotate the camera left/right in place. |
| **Particle** | One of many tiny short-lived things (a spark, a bubble). |
| **Pitch / yaw / roll** | Nod / shake / tilt sideways. |
| **Pivot** | The point something rotates around. |
| **Plane** | A flat surface. The "play area" is a vertical plane. |
| **POV** | Seen through a character's eyes (first person). |
| **Primitive** | A basic shape: sphere, box, cylinder, cone. |
| **Silhouette** | The outline of a shape. |
| **Smoothed** | Eased, with no sudden speed changes. |
| **Snappy** | Fast with a short settle. |
| **Tilt** | Rotate the camera up/down in place. |
| **Unit** | The scene's own measuring step (not metres). |
| **Zoom** | Change the lens so things get bigger without moving the camera. |

---

### One more thing: why curves are a good habit

Almost everything that "feels off" in motion is a speed-shape problem: too linear (robotic), too abrupt (jerky), or too symmetric (lifeless). If something feels wrong and you cannot say why, try describing its speed over time as a little curve in words ("it should start slow and rush at the end") or even sketch it. That one habit will fix most animation notes in a single round.
