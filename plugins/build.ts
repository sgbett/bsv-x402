import { execSync } from 'child_process'
import { cpSync, mkdirSync, existsSync, renameSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

const ROOT = resolve(__dirname, '..')
const PLUGINS = resolve(__dirname)
const DIST = resolve(ROOT, 'dist', 'plugins')
const SHARED = resolve(PLUGINS, 'shared')

type Target = 'chromium' | 'firefox' | 'safari'
const ALL_TARGETS: Target[] = ['chromium', 'firefox', 'safari']

// Parse --target flag
const targetArg = process.argv.find(a => a.startsWith('--target'))
const targetValue = targetArg?.includes('=')
  ? targetArg.split('=')[1]
  : process.argv[process.argv.indexOf('--target') + 1]
const targets: Target[] = targetValue
  ? [targetValue as Target]
  : ALL_TARGETS

function buildTarget(target: Target) {
  const outDir = join(DIST, target)

  console.log(`\n🔧 Building ${target}...`)

  // Ensure output directory
  mkdirSync(outDir, { recursive: true })
  mkdirSync(join(outDir, 'ui'), { recursive: true })
  mkdirSync(join(outDir, 'icons'), { recursive: true })

  // Bundle background.ts (service worker)
  execSync(`npx tsup ${join(SHARED, 'background.ts')} --out-dir ${outDir} --format esm --target es2020 --no-splitting --clean false`, { cwd: ROOT, stdio: 'inherit' })

  // Bundle content-script.ts
  execSync(`npx tsup ${join(SHARED, 'content-script.ts')} --out-dir ${outDir} --format iife --target es2020 --no-splitting --clean false`, { cwd: ROOT, stdio: 'inherit' })

  // Bundle page-script.ts (runs in page context, must be IIFE)
  execSync(`npx tsup ${join(SHARED, 'page-script.ts')} --out-dir ${outDir} --format iife --target es2020 --no-splitting --clean false`, { cwd: ROOT, stdio: 'inherit' })

  // Bundle UI scripts
  for (const uiScript of ['popup.ts', 'setup.ts', 'approve.ts']) {
    const scriptPath = join(SHARED, 'ui', uiScript)
    if (existsSync(scriptPath)) {
      execSync(`npx tsup ${scriptPath} --out-dir ${join(outDir, 'ui')} --format iife --target es2020 --no-splitting --clean false`, { cwd: ROOT, stdio: 'inherit' })
    }
  }

  // Copy manifest.json from target-specific directory
  cpSync(join(PLUGINS, target, 'manifest.json'), join(outDir, 'manifest.json'))

  // Copy UI HTML/CSS files
  for (const file of ['popup.html', 'popup.css', 'setup.html', 'approve.html']) {
    const src = join(SHARED, 'ui', file)
    if (existsSync(src)) {
      cpSync(src, join(outDir, 'ui', file))
    }
  }

  // Copy icons if they exist
  const iconsDir = join(SHARED, 'ui', 'icons')
  if (existsSync(iconsDir)) {
    cpSync(iconsDir, join(outDir, 'icons'), { recursive: true })
  }

  // Rename .mjs outputs to .js for extension compatibility
  // tsup ESM outputs .mjs, but manifests reference .js
  for (const dir of [outDir, join(outDir, 'ui')]) {
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir)) {
      if (file.endsWith('.mjs')) {
        renameSync(join(dir, file), join(dir, file.replace(/\.mjs$/, '.js')))
      }
    }
  }

  console.log(`✅ ${target} built → ${outDir}`)
}

// Build all targets
for (const target of targets) {
  buildTarget(target)
}

console.log('\n🎉 Plugin build complete!')
