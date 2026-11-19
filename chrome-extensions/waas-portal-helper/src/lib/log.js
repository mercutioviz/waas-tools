/** Console logging gated behind the `debug` setting. */

const PREFIX = '[waas-helper]';

let enabled = false;

export function setDebug(value) {
  enabled = Boolean(value);
}

export function log(...args) {
  if (enabled) console.log(PREFIX, ...args);
}

/** Warnings always print — they indicate something the user should know about. */
export function warn(...args) {
  console.warn(PREFIX, ...args);
}

export function error(...args) {
  console.error(PREFIX, ...args);
}
