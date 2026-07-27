# Natural Roll

[![Foundry VTT Version](https://img.shields.io/badge/Foundry%20VTT-v11%20--%20v14-orange.svg)](https://foundryvtt.com/)
[![Dependencies](https://img.shields.io/badge/Requires-Dice%20So%20Nice!-blue.svg)](https://foundryvtt.com/packages/dice-so-nice)

**Natural Roll** brings physical-feeling dice rolls to Foundry VTT. Instead of rolls immediately firing into animations automatically, this module holds the 3D dice on your screen, allowing you to grab, drag, shake, and flick/toss them just like real physical dice in your hand.

---

## 📽️ Showcase & Demonstration

Below are demonstrations of how the natural physics gestures work inside Foundry VTT:

### 1. Single Die Roll

_Grab, drag, and flick a single die across the screen._

<video src="https://raw.githubusercontent.com/Tomstar-2000/natural-roll/main/docs/assets/single-roll-demo.webm" autoplay loop muted playsinline width="100%"></video>

### 2. Rolling Multiple Dice (As a Group)

_Interact with multiple dice simultaneously, dragging the entire group and tossing them together._

<video src="https://raw.githubusercontent.com/Tomstar-2000/natural-roll/main/docs/assets/multiple-roll-demo.webm" autoplay loop muted playsinline width="100%"></video>

---

## ✨ Features

- 🎲 **Interactive Hold & Roll**: Intercepts standard rolls and gathers the 3D dice into a physical group beneath your cursor.
- 🎛️ **Gesture Control**: Drag the group around the canvas to shake them, and release with speed to throw.
- 📈 **Velocity Calculation**: Calculates your cursor's momentum (speed and direction) to apply authentic force and spin to the 3D dice.
- 🎨 **Full Dice So Nice! Compatibility**: Works seamlessly with all custom dice skins, models, and themes configured in Dice So Nice!.
- ⚙️ **Configurable Flick Sensitivity**: Adjust the flick strength multiplier to fine-tune how much power your mouse gestures translate to the throw.

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

---

## 🧩 Compatibility

- **Foundry VTT**: Verified compatibility with **v11**, **v12**, **v13**, and **v14**.
- **Required Modules**: [Dice So Nice!](https://foundryvtt.com/packages/dice-so-nice) must be installed and active.
- **Workflow Modules**: Compatible with roll automation systems like Midi-QOL.

---

## 📄 License

This module is licensed under the MIT License. See [LICENSE](LICENSE) for details.
