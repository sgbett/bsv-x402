/// <reference types="chrome" />

// Safari Web Extensions use the `browser` namespace (WebExtensions API)
declare const browser: typeof chrome

const api = typeof browser !== 'undefined' ? browser : chrome

export const runtime = api.runtime
export const storageLocal = api.storage.local
export const tabs = api.tabs
export const alarms = api.alarms
export const windows = api.windows

export const PLATFORM = 'safari' as const
