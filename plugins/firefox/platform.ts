/// <reference types="chrome" />

// Firefox uses the `browser` namespace but also supports `chrome` for compat.
// Prefer `browser` where available for Promise-based APIs.
declare const browser: typeof chrome

const api = typeof browser !== 'undefined' ? browser : chrome

export const runtime = api.runtime
export const storageLocal = api.storage.local
export const tabs = api.tabs
export const alarms = api.alarms
export const windows = api.windows

export const PLATFORM = 'firefox' as const
