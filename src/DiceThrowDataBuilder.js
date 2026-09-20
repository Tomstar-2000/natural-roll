import { log, error, getAuthorizedUsers } from "./utils.js";

export class DiceThrowDataBuilder {
    static sanitizeThrows(throws) {
        return (throws || []).map(t => {
            return {
                dice: (t.dice || []).map(d => {
                    return {
                        type: d.type,
                        id: d.options?.naturalRollDieId ? `${d.options.naturalRollDieId}-${d.id}` : d.id,
                        result: d.result,
                        resultLabel: d.resultLabel,
                        fvttResult: d.fvttResult,
                        vectors: d.vectors ? {
                            pos: d.vectors.pos,
                            velocity: d.vectors.velocity,
                            angle: d.vectors.angle
                        } : undefined,
                        options: d.options,
                        appearance: d.appearance ? {
                            colorset: d.appearance.colorset,
                            labelColor: d.appearance.labelColor,
                            diceColor: d.appearance.diceColor,
                            outlineColor: d.appearance.outlineColor,
                            edgeColor: d.appearance.edgeColor,
                            material: d.appearance.material,
                            font: d.appearance.font,
                            foreground: d.appearance.foreground,
                            background: d.appearance.background,
                            outline: d.appearance.outline,
                            edge: d.appearance.edge,
                            texture: typeof d.appearance.texture === "object" ? d.appearance.texture?.name : d.appearance.texture,
                            fontScale: d.appearance.fontScale,
                            system: d.appearance.system,
                            systemSettings: d.appearance.systemSettings
                        } : undefined
                    };
                }),
                dsnConfig: t.dsnConfig ? {
                    appearance: t.dsnConfig.appearance,
                    diceLibrary: t.dsnConfig.diceLibrary
                } : undefined,
                isNaturalRollReplay: true,
                isNaturalRollManual: true
            };
        });
    }

    static mapDiceIdsToRollerIds(values, localDiceList) {
        const mapped = {};
        for (const [localId, val] of Object.entries(values || {})) {
            const dicemesh = localDiceList.find(d => d.id === Number(localId));
            const rollerId = dicemesh?.userData?.rollerId || dicemesh?.options?.naturalRollDieId || localId;
            mapped[rollerId] = val;
        }
        return mapped;
    }

    static broadcastManualRollPayload({
        naturalRollId,
        throws,
        localDiceList,
        faceValues,
        finalQuaternions,
        trajectories,
        detectedCollides,
        iterationsNeeded,
        deads
    }) {
        try {
            const mappedFaceValues = this.mapDiceIdsToRollerIds(faceValues, localDiceList);
            const mappedFinalQuaternions = this.mapDiceIdsToRollerIds(finalQuaternions, localDiceList);
            const sanitizedThrows = this.sanitizeThrows(throws);

            const roll = game.dice3d?._currentLocalRoll;
            const authorizedUsers = getAuthorizedUsers(roll);
            const payload = {
                user: game.user.id,
                naturalRollId: naturalRollId,
                throws: sanitizedThrows,
                trajectories: trajectories,
                detectedCollides: detectedCollides,
                iterationsNeeded: iterationsNeeded,
                faceValues: mappedFaceValues,
                finalQuaternions: mappedFinalQuaternions,
                deads: deads ? Array.from(deads) : undefined,
                screenWidth: game.dice3d?.canvas?.clientWidth || window.innerWidth,
                screenHeight: game.dice3d?.canvas?.clientHeight || window.innerHeight,
                authorizedUsers: authorizedUsers,
                magicalEffectStyle: game.settings.get("natural-roll", "magicalEffectStyle")
            };

            log("Broadcasting manual roll replay payload to other players...", payload);
            game.socket.emit("module.natural-roll", {
                type: "throw",
                payload: payload
            });
            return payload;
        } catch (err) {
            error("Failed to broadcast manual roll results:", err);
            return null;
        }
    }
}
