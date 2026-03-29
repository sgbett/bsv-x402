/// <reference types="chrome" />

export const runtime = chrome.runtime
export const storageLocal = chrome.storage.local
export const tabs = chrome.tabs
export const alarms = chrome.alarms
export const windows = chrome.windows

export const PLATFORM = 'chromium' as const
