import { execSync } from 'child_process'
import { cpSync, mkdirSync, existsSync, renameSync, readdirSync } from 'fs'
import { resolve, join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
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
  execSync(`npx tsup ${join(SHARED, 'background.ts')} --out-dir ${outDir} --format esm --target es2020 --no-splitting --no-dts --clean false`, { cwd: ROOT, stdio: 'inherit' })

  // Bundle content-script.ts
  execSync(`npx tsup ${join(SHARED, 'content-script.ts')} --out-dir ${outDir} --format iife --target es2020 --no-splitting --no-dts --clean false`, { cwd: ROOT, stdio: 'inherit' })

  // Bundle page-script.ts (runs in page context, must be IIFE)
  execSync(`npx tsup ${join(SHARED, 'page-script.ts')} --out-dir ${outDir} --format iife --target es2020 --no-splitting --no-dts --clean false`, { cwd: ROOT, stdio: 'inherit' })

  // Bundle UI scripts — shell popup at ui/, wallet and x402 panels in subdirs
  const uiScripts = [
    { src: join(SHARED, 'ui', 'popup.ts'), outDir: join(outDir, 'ui') },
    { src: join(SHARED, 'ui', 'wallet', 'setup.ts'), outDir: join(outDir, 'ui', 'wallet') },
    { src: join(SHARED, 'ui', 'x402', 'approve.ts'), outDir: join(outDir, 'ui', 'x402') },
  ]
  for (const { src, outDir: scriptOutDir } of uiScripts) {
    if (existsSync(src)) {
      mkdirSync(scriptOutDir, { recursive: true })
      execSync(`npx tsup ${src} --out-dir ${scriptOutDir} --format iife --target es2020 --no-splitting --no-dts --clean false`, { cwd: ROOT, stdio: 'inherit' })
    }
  }

  // Copy manifest.json from target-specific directory
  cpSync(join(PLUGINS, target, 'manifest.json'), join(outDir, 'manifest.json'))

  // Copy UI HTML/CSS files
  const uiFiles = [
    { src: join(SHARED, 'ui', 'popup.html'), dest: join(outDir, 'ui', 'popup.html') },
    { src: join(SHARED, 'ui', 'popup.css'), dest: join(outDir, 'ui', 'popup.css') },
    { src: join(SHARED, 'ui', 'wallet', 'setup.html'), dest: join(outDir, 'ui', 'wallet', 'setup.html') },
    { src: join(SHARED, 'ui', 'x402', 'approve.html'), dest: join(outDir, 'ui', 'x402', 'approve.html') },
  ]
  for (const { src, dest } of uiFiles) {
    if (existsSync(src)) {
      mkdirSync(join(dest, '..'), { recursive: true })
      cpSync(src, dest)
    }
  }

  // Copy icons if they exist
  const iconsDir = join(SHARED, 'ui', 'icons')
  if (existsSync(iconsDir)) {
    cpSync(iconsDir, join(outDir, 'icons'), { recursive: true })
  }

  // Rename tsup outputs to match manifest expectations
  // ESM: .mjs → .js | IIFE: .global.js → .js
  for (const dir of [outDir, join(outDir, 'ui'), join(outDir, 'ui', 'wallet'), join(outDir, 'ui', 'x402')]) {
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir)) {
      if (file.endsWith('.mjs')) {
        renameSync(join(dir, file), join(dir, file.replace(/\.mjs$/, '.js')))
      } else if (file.endsWith('.global.js')) {
        renameSync(join(dir, file), join(dir, file.replace(/\.global\.js$/, '.js')))
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
