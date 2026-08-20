export function log(message, ...args) {
    console.log(`%cNatural Roll %c| ${message}`, "color: #ffaa00; font-weight: bold; background: #222; padding: 2px 4px; border-radius: 3px;", "color: inherit;", ...args);
}

export function error(message, ...args) {
    console.error(`%cNatural Roll %c| ${message}`, "color: #ff3333; font-weight: bold; background: #222; padding: 2px 4px; border-radius: 3px;", "color: inherit;", ...args);
}

export function getAuthorizedUsers(roll = null) {
    if (globalThis._naturalRollMessageVisibility) {
        const { whisper, blind, rollMode } = globalThis._naturalRollMessageVisibility;
        if (whisper && whisper.length > 0) {
            if (blind) {
                return game.users.filter(u => u.isGM).map(u => u.id);
            } else {
                const set = new Set(whisper);
                set.add(game.user.id);
                return Array.from(set);
            }
        }
        if (rollMode === "self" || rollMode === "selfroll") {
            return [game.user.id];
        } else if (rollMode === "gm" || rollMode === "gmroll") {
            const set = new Set(game.users.filter(u => u.isGM).map(u => u.id));
            set.add(game.user.id);
            return Array.from(set);
        } else if (rollMode === "blind" || rollMode === "blindroll") {
            return game.users.filter(u => u.isGM).map(u => u.id);
        }
    }

    let rollMode = roll?.options?.messageMode || roll?.options?.rollMode;
    
    if (!rollMode && typeof document !== "undefined") {
        const activeModeButton = document.querySelector('#message-modes button[aria-pressed="true"]');
        if (activeModeButton) {
            rollMode = activeModeButton.dataset.mode;
        } else {
            const selectEl = document.querySelector('select[name="rollMode"]');
            if (selectEl) {
                rollMode = selectEl.value;
            }
        }
    }

    if (!rollMode) {
        rollMode = game.settings.get("core", "rollMode");
    }
    
    if (roll?.options?.whisper && roll.options.whisper.length > 0) {
        const whisper = roll.options.whisper;
        if (roll.options.blind) {
            return game.users.filter(u => u.isGM).map(u => u.id);
        } else {
            const set = new Set(whisper);
            set.add(game.user.id);
            return Array.from(set);
        }
    }

    if (rollMode === "self" || rollMode === "selfroll") {
        return [game.user.id];
    } else if (rollMode === "gm" || rollMode === "gmroll") {
        const set = new Set(game.users.filter(u => u.isGM).map(u => u.id));
        set.add(game.user.id);
        return Array.from(set);
    } else if (rollMode === "blind" || rollMode === "blindroll") {
        return game.users.filter(u => u.isGM).map(u => u.id);
    }
    
    return null;
}

export function getAuthorizedUsersFromMessage(message) {
    const whisper = message.whisper || [];
    const blind = message.blind || false;
    
    if (whisper.length > 0) {
        if (blind) {
            return game.users.filter(u => u.isGM).map(u => u.id);
        }
        const set = new Set(whisper);
        const authorId = message.author?.id || message.user?.id || game.user.id;
        set.add(authorId);
        return Array.from(set);
    }
    
    const rollMode = message.rollMode;
    if (rollMode === "self" || rollMode === "selfroll") {
        const authorId = message.author?.id || message.user?.id || game.user.id;
        return [authorId];
    } else if (rollMode === "gm" || rollMode === "gmroll") {
        const authorId = message.author?.id || message.user?.id || game.user.id;
        const set = new Set(game.users.filter(u => u.isGM).map(u => u.id));
        set.add(authorId);
        return Array.from(set);
    } else if (rollMode === "blind" || rollMode === "blindroll") {
        return game.users.filter(u => u.isGM).map(u => u.id);
    }
    return null;
}

