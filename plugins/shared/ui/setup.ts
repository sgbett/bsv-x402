/// <reference types="chrome" />

// ---------------------------------------------------------------------------
// DOM elements
// ---------------------------------------------------------------------------

const modeCreate = document.getElementById('mode-create') as HTMLInputElement
const modeImport = document.getElementById('mode-import') as HTMLInputElement

const seedCreateArea = document.getElementById('seed-create-area') as HTMLDivElement
const seedImportArea = document.getElementById('seed-import-area') as HTMLDivElement
const seedText = document.getElementById('seed-text') as HTMLSpanElement
const seedInput = document.getElementById('seed-input') as HTMLTextAreaElement
const copySeedBtn = document.getElementById('copy-seed-btn') as HTMLButtonElement
const seedWarning = document.getElementById('seed-warning') as HTMLDivElement

const passwordInput = document.getElementById('password') as HTMLInputElement
const passwordConfirm = document.getElementById('password-confirm') as HTMLInputElement
const passwordError = document.getElementById('password-error') as HTMLDivElement

const tierSelect = document.getElementById('tier-select') as HTMLSelectElement
const completeBtn = document.getElementById('complete-btn') as HTMLButtonElement

const setupForm = document.getElementById('setup-form') as HTMLDivElement
const successOverlay = document.getElementById('success-overlay') as HTMLDivElement

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let generatedSeed: string | null = null

// ---------------------------------------------------------------------------
// Seed generation
// ---------------------------------------------------------------------------

/**
 * Request the background script to generate a seed phrase, or fall back to a
 * locally-generated random hex string if the background handler is not wired
 * up yet.
 */
async function generateSeed(): Promise<string> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'generateSeed' }, (response) => {
      if (chrome.runtime.lastError || !response?.seed) {
        // Fallback: generate a random 128-bit hex string locally.
        // A real implementation would use BIP-39 mnemonic generation.
        const bytes = crypto.getRandomValues(new Uint8Array(16))
        const hex = Array.from(bytes)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
        resolve(hex)
      } else {
        resolve(response.seed as string)
      }
    })
  })
}

// ---------------------------------------------------------------------------
// Mode switching
// ---------------------------------------------------------------------------

function showCreateMode(): void {
  seedCreateArea.classList.add('visible')
  seedImportArea.classList.remove('visible')
  seedWarning.classList.add('visible')

  // Generate a new seed on first switch
  if (!generatedSeed) {
    generateSeed().then((seed) => {
      generatedSeed = seed
      seedText.textContent = seed
    })
  }
}

function showImportMode(): void {
  seedCreateArea.classList.remove('visible')
  seedImportArea.classList.add('visible')
  seedWarning.classList.remove('visible')
}

modeCreate.addEventListener('change', () => {
  if (modeCreate.checked) showCreateMode()
})

modeImport.addEventListener('change', () => {
  if (modeImport.checked) showImportMode()
})

// ---------------------------------------------------------------------------
// Copy seed to clipboard
// ---------------------------------------------------------------------------

copySeedBtn.addEventListener('click', async () => {
  const text = seedText.textContent ?? ''
  if (!text || text === 'Generating...') return

  try {
    await navigator.clipboard.writeText(text)
    const original = copySeedBtn.textContent
    copySeedBtn.textContent = 'Copied!'
    setTimeout(() => {
      copySeedBtn.textContent = original
    }, 1500)
  } catch {
    // Fallback for environments where clipboard API is unavailable
    const textarea = document.createElement('textarea')
    textarea.value = text
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)

    const original = copySeedBtn.textContent
    copySeedBtn.textContent = 'Copied!'
    setTimeout(() => {
      copySeedBtn.textContent = original
    }, 1500)
  }
})

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validatePasswords(): string | null {
  const pw = passwordInput.value
  const pwc = passwordConfirm.value

  if (pw.length < 8) {
    return 'Password must be at least 8 characters.'
  }
  if (pw !== pwc) {
    return 'Passwords do not match.'
  }
  return null
}

function showPasswordError(msg: string): void {
  passwordError.textContent = msg
  passwordError.classList.add('visible')
}

function clearPasswordError(): void {
  passwordError.textContent = ''
  passwordError.classList.remove('visible')
}

// Clear error on input
passwordInput.addEventListener('input', clearPasswordError)
passwordConfirm.addEventListener('input', clearPasswordError)

// ---------------------------------------------------------------------------
// Complete setup
// ---------------------------------------------------------------------------

completeBtn.addEventListener('click', () => {
  clearPasswordError()

  // Determine seed
  const isCreateMode = modeCreate.checked
  const seed = isCreateMode ? generatedSeed : seedInput.value.trim()

  if (!seed) {
    if (isCreateMode) {
      showPasswordError('Seed has not been generated yet. Please wait.')
    } else {
      showPasswordError('Please enter your seed phrase.')
    }
    return
  }

  // Validate password
  const pwError = validatePasswords()
  if (pwError) {
    showPasswordError(pwError)
    return
  }

  const password = passwordInput.value
  const tier = tierSelect.value

  // Disable button while processing
  completeBtn.disabled = true
  completeBtn.textContent = 'Setting up...'

  chrome.runtime.sendMessage(
    {
      type: 'setup',
      payload: { seed, password, tier },
    },
    (response) => {
      if (chrome.runtime.lastError) {
        showPasswordError(`Setup failed: ${chrome.runtime.lastError.message}`)
        completeBtn.disabled = false
        completeBtn.textContent = 'Complete Setup'
        return
      }

      if (response?.status === 'error') {
        showPasswordError(`Setup failed: ${response.error ?? 'Unknown error'}`)
        completeBtn.disabled = false
        completeBtn.textContent = 'Complete Setup'
        return
      }

      // Success — show confirmation
      setupForm.style.display = 'none'
      successOverlay.classList.add('visible')

      // Close tab after a short delay
      setTimeout(() => {
        window.close()
      }, 3000)
    },
  )
})

// ---------------------------------------------------------------------------
// Initialise
// ---------------------------------------------------------------------------

// Generate seed on page load when in create mode
showCreateMode()
