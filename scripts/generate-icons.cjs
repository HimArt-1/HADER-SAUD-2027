#!/usr/bin/env node
// =============================================================================
// نظام حاضر (Hader) - Icon Generator Script
// =============================================================================
// This script generates all required icon formats from the source logo

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SOURCE_ICON = path.join(__dirname, '../public/logo512.png');
const BUILD_DIR = path.join(__dirname, '../build');
const ICONS_DIR = path.join(BUILD_DIR, 'icons');

// Ensure directories exist
if (!fs.existsSync(BUILD_DIR)) fs.mkdirSync(BUILD_DIR, { recursive: true });
if (!fs.existsSync(ICONS_DIR)) fs.mkdirSync(ICONS_DIR, { recursive: true });

console.log('🎨 Generating icons for Hader System...\n');

// Check if source icon exists
if (!fs.existsSync(SOURCE_ICON)) {
  console.error('❌ Source icon not found:', SOURCE_ICON);
  console.log('   Please ensure public/logo512.png exists');
  process.exit(1);
}

// Check for available image processing tools
const hasSips = process.platform === 'darwin';
const hasConvert = (() => {
  try {
    execSync('which convert', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const hasPng2icns = (() => {
  try {
    execSync('which png2icns', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

// Generate icons based on available tools
if (hasSips && process.platform === 'darwin') {
  console.log('🍎 Using macOS sips for icon generation...\n');
  
  // Generate PNG icons for Linux/Windows
  const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
  sizes.forEach(size => {
    const output = path.join(ICONS_DIR, `${size}x${size}.png`);
    try {
      execSync(`sips -z ${size} ${size} "${SOURCE_ICON}" --out "${output}"`, { stdio: 'ignore' });
      console.log(`  ✓ ${size}x${size}.png`);
    } catch (e) {
      console.log(`  ✗ ${size}x${size}.png (failed)`);
    }
  });

  // Copy main icon
  fs.copyFileSync(SOURCE_ICON, path.join(BUILD_DIR, 'icon.png'));
  console.log('  ✓ icon.png (512x512)');

  // Generate .icns for macOS (requires iconutil)
  console.log('\n🍎 Generating macOS .icns...');
  const iconsetPath = path.join(BUILD_DIR, 'icon.iconset');
  if (!fs.existsSync(iconsetPath)) fs.mkdirSync(iconsetPath, { recursive: true });
  
  const icnsMap = {
    'icon_16x16.png': 16,
    'icon_16x16@2x.png': 32,
    'icon_32x32.png': 32,
    'icon_32x32@2x.png': 64,
    'icon_128x128.png': 128,
    'icon_128x128@2x.png': 256,
    'icon_256x256.png': 256,
    'icon_256x256@2x.png': 512,
    'icon_512x512.png': 512,
    'icon_512x512@2x.png': 1024
  };

  Object.entries(icnsMap).forEach(([name, size]) => {
    const output = path.join(iconsetPath, name);
    try {
      execSync(`sips -z ${size} ${size} "${SOURCE_ICON}" --out "${output}"`, { stdio: 'ignore' });
    } catch (e) {}
  });

  try {
    execSync(`iconutil -c icns "${iconsetPath}" -o "${path.join(BUILD_DIR, 'icon.icns')}"`, { stdio: 'ignore' });
    console.log('  ✓ icon.icns');
  } catch (e) {
    console.log('  ✗ icon.icns (iconutil failed)');
  }

  // Clean up iconset
  fs.rmSync(iconsetPath, { recursive: true, force: true });

  // Also generate .ico for Windows using ImageMagick if available
  if (hasConvert) {
    console.log('\n🪟 Generating Windows .ico with ImageMagick...');
    try {
      execSync(`magick "${SOURCE_ICON}" -define icon:auto-resize=256,128,64,48,32,16 "${path.join(BUILD_DIR, 'icon.ico')}"`, { stdio: 'ignore' });
      console.log('  ✓ icon.ico');
    } catch (e) {
      // Try older convert command
      try {
        execSync(`convert "${SOURCE_ICON}" -define icon:auto-resize=256,128,64,48,32,16 "${path.join(BUILD_DIR, 'icon.ico')}"`, { stdio: 'ignore' });
        console.log('  ✓ icon.ico');
      } catch (e2) {
        console.log('  ✗ icon.ico (ImageMagick failed)');
      }
    }
  } else {
    console.log('\n⚠️  ImageMagick not found. Windows .ico not generated.');
    console.log('   Install: brew install imagemagick');
  }

} else if (hasConvert) {
  console.log('🔧 Using ImageMagick for icon generation...\n');
  
  // Generate PNG icons
  const sizes = [16, 32, 48, 64, 128, 256, 512];
  sizes.forEach(size => {
    const output = path.join(ICONS_DIR, `${size}x${size}.png`);
    try {
      execSync(`convert "${SOURCE_ICON}" -resize ${size}x${size} "${output}"`, { stdio: 'ignore' });
      console.log(`  ✓ ${size}x${size}.png`);
    } catch (e) {
      console.log(`  ✗ ${size}x${size}.png (failed)`);
    }
  });

  // Copy main icon
  fs.copyFileSync(SOURCE_ICON, path.join(BUILD_DIR, 'icon.png'));
  console.log('  ✓ icon.png');

  // Generate .ico for Windows
  console.log('\n🪟 Generating Windows .ico...');
  try {
    execSync(`convert "${SOURCE_ICON}" -define icon:auto-resize=256,128,64,48,32,16 "${path.join(BUILD_DIR, 'icon.ico')}"`, { stdio: 'ignore' });
    console.log('  ✓ icon.ico');
  } catch (e) {
    console.log('  ✗ icon.ico (failed)');
  }

} else {
  console.log('⚠️  No image processing tool found (sips, ImageMagick)');
  console.log('   Copying source icon as fallback...\n');
  
  // Just copy the source icon
  fs.copyFileSync(SOURCE_ICON, path.join(BUILD_DIR, 'icon.png'));
  fs.copyFileSync(SOURCE_ICON, path.join(ICONS_DIR, '512x512.png'));
  fs.copyFileSync(SOURCE_ICON, path.join(ICONS_DIR, '256x256.png'));
  
  console.log('  ✓ icon.png');
  console.log('  ✓ 512x512.png');
  console.log('  ✓ 256x256.png');
  
  console.log('\n📝 To generate proper .icns and .ico files, install:');
  console.log('   - macOS: iconutil (built-in)');
  console.log('   - All platforms: ImageMagick (brew install imagemagick)');
}

console.log('\n✅ Icon generation complete!');
console.log('   Output directory:', BUILD_DIR);
