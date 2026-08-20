export function log(message, ...args) {
    console.log(`%cNatural Roll %c| ${message}`, "color: #ffaa00; font-weight: bold; background: #222; padding: 2px 4px; border-radius: 3px;", "color: inherit;", ...args);
}

export function error(message, ...args) {
    console.error(`%cNatural Roll %c| ${message}`, "color: #ff3333; font-weight: bold; background: #222; padding: 2px 4px; border-radius: 3px;", "color: inherit;", ...args);
}
