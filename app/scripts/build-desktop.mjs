import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const command = process.argv[2] ?? 'current';

const platformName = () => {
  if (process.platform === 'darwin') return 'macOS';
  if (process.platform === 'win32') return 'Windows';
  if (process.platform === 'linux') return 'Linux';
  return process.platform;
};

const requirePlatform = (expected, label) => {
  if (process.platform === expected) return;
  console.error(`当前系统是 ${platformName()}，不能构建 ${label} 安装包。`);
  console.error('Tauri 安装包需要在对应系统上构建：macOS 构建 app/dmg，Windows 构建 nsis/msi，Linux 构建 deb/rpm/appimage。');
  console.error('请在对应系统或 CI runner 上执行该脚本。');
  process.exit(1);
};

const commandFor = (value) => {
  if (value === 'current') {
    if (process.platform === 'darwin') return commandFor('mac');
    if (process.platform === 'win32') return commandFor('windows');
    if (process.platform === 'linux') return commandFor('linux');
    console.error(`暂不支持当前系统：${process.platform}`);
    process.exit(1);
  }

  if (value === 'mac') {
    requirePlatform('darwin', 'macOS universal');
    return ['build', '--target', 'universal-apple-darwin', '--bundles', 'app,dmg'];
  }

  if (value === 'mac:intel') {
    requirePlatform('darwin', 'macOS Intel');
    return ['build', '--target', 'x86_64-apple-darwin', '--bundles', 'app,dmg'];
  }

  if (value === 'mac:apple') {
    requirePlatform('darwin', 'macOS Apple Silicon');
    return ['build', '--target', 'aarch64-apple-darwin', '--bundles', 'app,dmg'];
  }

  if (value === 'mac:universal') {
    return commandFor('mac');
  }

  if (value === 'windows') {
    requirePlatform('win32', 'Windows');
    return ['build', '--bundles', 'nsis,msi'];
  }

  if (value === 'windows:cross') {
    if (process.platform === 'win32') {
      console.error('当前系统是 Windows，请直接使用 build:windows 构建 NSIS 和 MSI 安装包。');
      process.exit(1);
    }
    return [
      'build',
      '--runner',
      'cargo-xwin',
      '--target',
      'x86_64-pc-windows-msvc',
      '--config',
      'src-tauri/tauri.windows-cross.conf.json',
    ];
  }

  if (value === 'linux') {
    requirePlatform('linux', 'Linux');
    return ['build', '--bundles', 'deb,rpm,appimage'];
  }

  if (value === 'raw') {
    return ['build', '--no-bundle'];
  }

  console.error(`未知桌面构建目标：${value}`);
  process.exit(1);
};

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const env = { ...process.env };

if (command === 'windows:cross') {
  env.XWIN_CACHE_DIR = env.MAGPIE_XWIN_CACHE_DIR
    || env.XWIN_CACHE_DIR
    || fileURLToPath(new URL('../src-tauri/target/xwin-cache', import.meta.url));
}

const result = spawnSync(pnpm, ['exec', 'tauri', ...commandFor(command)], {
  cwd: new URL('..', import.meta.url),
  env,
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
