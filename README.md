# Natural Roll

[![Foundry VTT Version](https://img.shields.io/badge/Foundry%20VTT-v11%20--%20v14-orange.svg)](https://foundryvtt.com/)
[![Dependencies](https://img.shields.io/badge/Requires-Dice%20So%20Nice!-blue.svg)](https://foundryvtt.com/packages/dice-so-nice)

**Natural Roll** brings physical-feeling dice rolls to Foundry VTT. Instead of rolls immediately firing into animations automatically, this module holds the 3D dice on your screen, allowing you to grab, drag, shake, and flick/toss them just like real physical dice in your hand.

- It is truly dynamic: The outcome of your roll is determined entirely by the physics of your grab and flick (speed, angle, and wall bounces).
- How it works: Foundry normally pre-calculates the result using RNG. Natural Roll overrides this by clearing the pre-determined result and feeding the actual physical landing face of the 3D dice back into Foundry to generate the chat card.

> ℹ️ **Automation Override Support:** Currently, roll automation override is only implemented for the **dnd5e** system using **Midi-QOL**. If you are using other game systems or automation modules and want support added, please raise a ticket/issue specifying the game system and automation module details.

---

## 📽️ Showcase & Demonstration

Below are demonstrations of how the natural physics gestures work inside Foundry VTT:

### 1. Single Die Roll

_Grab, drag, and flick a single die across the screen._

<video src="https://github.com/user-attachments/assets/fd5d7a5f-a569-4183-bc3f-c2e48fa532cd" autoplay loop muted playsinline width="100%"></video>

### 2. Rolling Multiple Dice (As a Group)

_Interact with multiple dice simultaneously, dragging the entire group and tossing them together._

<video src="https://github.com/user-attachments/assets/d8580acf-1e43-4281-b8c1-8fd0d165de2a" autoplay loop muted playsinline width="100%"></video>

---

## ✨ Features

- 🎲 **Interactive Hold & Roll**: Intercepts standard rolls and gathers the 3D dice into a physical group beneath your cursor.
- 🎛️ **Gesture Control**: Drag the group around the canvas to shake them, and release with speed to throw.
- 📈 **Velocity Calculation**: Calculates your cursor's momentum (speed and direction) to apply authentic force and spin to the 3D dice.
- 🎨 **Full Dice So Nice! Compatibility**: Works seamlessly with all custom dice skins, models, and themes configured in Dice So Nice!.
- ⚙️ **Configurable Flick Sensitivity**: Adjust the flick strength multiplier to fine-tune how much power your mouse gestures translate to the throw.
- 📍 **Spawn Dice at Cursor**: Option to spawn the initial dice pool directly under your mouse/pointer instead of the center of the screen.
- 🔊 **Rattle Sound Effects**: Interactive rattle collision sounds play as you shake or drag the dice in your hand. Respects your configured Dice So Nice! sound surface (e.g. plastic, wood) and volume.
- ↔️ **Configurable Dice Spacing/Spread**: Fine-tune the initial spacing of your dice pool via a settings slider to prevent large batches of dice from overlapping.
- 📱 **Mobile & Touch Support**: Full compatibility with touch and pen pointer gestures, featuring multi-touch pointer tracking.

---

## 🛠️ Installation

To install the module, follow these steps:

1. Open the Foundry VTT Setup screen.
2. Go to the **Add-on Modules** tab.
3. Click **Install Module**.
4. Paste the following Manifest URL into the field at the bottom:
   ```
   https://github.com/Tomstar-2000/natural-roll/releases/latest/download/module.json
   ```
5. Click **Install**.
6. Activate **Natural Roll** and **Dice So Nice!** in your active game world.

---

## ⚙️ Configuration Settings

Each player can customize their experience in **Game Settings -> Configure Settings -> Natural Roll**:

| Setting                      | Scope | Type    | Default | Description                                                                                                             |
| ---------------------------- | ----- | ------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Enable Natural Roll**      | User  | Boolean | `true`  | When enabled, standard rolls will wait for you to drag and flick them on the canvas.                                    |
| **Flick Strength**           | User  | Number  | `1.0`   | Multiplier for your flick speed (range: `0.1` to `5.0`). Increase if you want more explosive throws with less movement. |
| **Enable Auto-Roll Timeout** | GM    | Boolean | `true`  | Automatically rolls the dice if the player does not pick them up.                                                       |
| **Auto-Roll Timeout**        | GM    | Number  | `15`    | Time in seconds before a timeout triggers (range: `3` to `60` seconds).                                                 |
| **Grab Radius**              | GM    | Number  | `80`    | Minimum pixel distance from a die required to grab/pick it up (range: `20` to `200` pixels).                            |
| **Spawn Dice at Cursor**     | User  | Boolean | `false` | Spawns the dice directly under your mouse/pointer instead of the center of the screen.                                  |
| **Enable Shake SFX**         | User  | Boolean | `true`  | Plays rattling/collision sound effects when shaking the dice in your hand.                                              |
| **Dice Spread / Spacing**    | User  | Number  | `0.06`  | Adjusts the spacing/spread scale of the initial dice pool (range: `0.04` to `0.12`).                                    |

---

## 🧩 Compatibility

- **Foundry VTT**: Verified compatibility with **v11**, **v12**, **v13**, and **v14**.
- **Required Modules**: [Dice So Nice!](https://foundryvtt.com/packages/dice-so-nice) must be installed and active.
- **Workflow Modules**: Compatible with roll automation systems like Midi-QOL.

---

## 📄 License

This module is licensed under the MIT License. See [LICENSE](LICENSE) for details.
