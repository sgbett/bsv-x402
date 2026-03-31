# Safari Web Extension — Xcode Setup

Safari requires web extensions to be wrapped in a native macOS/iOS app container.
Apple provides a conversion tool that generates the Xcode project from your extension files.

## Prerequisites

- macOS with Xcode installed
- Apple Developer account (for distribution)

## Steps

1. Build the Safari extension files:
   ```bash
   npm run build:safari
   ```

2. Convert to an Xcode project:
   ```bash
   xcrun safari-web-extension-converter dist/plugins/safari/ \
     --project-location plugins/safari/xcode/project \
     --app-name "bsv-x402 Wallet" \
     --bundle-identifier com.bsv-x402.wallet \
     --swift
   ```

3. Open the generated project in Xcode:
   ```bash
   open plugins/safari/xcode/project/bsv-x402\ Wallet.xcodeproj
   ```

4. In Xcode:
   - Select your development team
   - Build and run (Cmd+R)
   - Enable the extension in Safari → Preferences → Extensions

## Distribution

For App Store distribution, archive the project in Xcode and submit via App Store Connect.

## Notes

- The converter generates both macOS and iOS targets
- The `dist/plugins/safari/` directory must contain the built JS files and manifest.json
- Re-run the converter after any manifest.json changes
