import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, '..');
const repoRoot = resolve(appDir, '..');
const requestedTarget = process.argv[2] ?? 'x64';
const docker = process.platform === 'win32' ? 'docker.exe' : 'docker';
const builderImage = process.env.MAGPIE_LINUX_BUILDER_IMAGE ?? 'magpie-music/linux-builder:bookworm';
const dockerfilePath = resolve(appDir, 'docker/linux-builder.Dockerfile');
const useChinaMirrors = process.env.MAGPIE_LINUX_USE_CHINA_MIRRORS !== '0';
const mirrorBuildArgs = {
  NODE_IMAGE: process.env.MAGPIE_LINUX_NODE_IMAGE ?? 'node:22-bookworm',
  APT_MIRROR: process.env.MAGPIE_LINUX_APT_MIRROR ?? (useChinaMirrors ? 'https://mirrors.tuna.tsinghua.edu.cn/debian' : ''),
  DEBIAN_SECURITY_MIRROR: process.env.MAGPIE_LINUX_DEBIAN_SECURITY_MIRROR
    ?? (useChinaMirrors ? 'https://mirrors.tuna.tsinghua.edu.cn/debian-security' : ''),
  NPM_REGISTRY: process.env.MAGPIE_LINUX_NPM_REGISTRY
    ?? (useChinaMirrors ? 'https://registry.npmmirror.com' : 'https://registry.npmjs.org'),
  RUSTUP_DIST_SERVER: process.env.MAGPIE_LINUX_RUSTUP_DIST_SERVER
    ?? (useChinaMirrors ? 'https://mirrors.tuna.tsinghua.edu.cn/rustup' : 'https://static.rust-lang.org'),
  RUSTUP_UPDATE_ROOT: process.env.MAGPIE_LINUX_RUSTUP_UPDATE_ROOT
    ?? (useChinaMirrors ? 'https://mirrors.tuna.tsinghua.edu.cn/rustup/rustup' : 'https://static.rust-lang.org/rustup'),
  CARGO_REGISTRY: process.env.MAGPIE_LINUX_CARGO_REGISTRY
    ?? (useChinaMirrors ? 'sparse+https://rsproxy.cn/index/' : ''),
};
const tauriToolDownloadMirror = process.env.MAGPIE_LINUX_TAURI_TOOL_DOWNLOAD_MIRROR
  ?? (useChinaMirrors ? 'https://mirror.ghproxy.com' : '');
const tauriBundlerMirror = process.env.MAGPIE_LINUX_TAURI_BUNDLER_GITHUB_MIRROR ?? '';
const tauriBundlerMirrorTemplate = process.env.MAGPIE_LINUX_TAURI_BUNDLER_GITHUB_MIRROR_TEMPLATE ?? '';

const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

const tauriBundlerMirrorEnv = [
  tauriBundlerMirror
    ? `export TAURI_BUNDLER_TOOLS_GITHUB_MIRROR=${shellQuote(tauriBundlerMirror)}`
    : '',
  tauriBundlerMirrorTemplate
    ? `export TAURI_BUNDLER_TOOLS_GITHUB_MIRROR_TEMPLATE=${shellQuote(tauriBundlerMirrorTemplate)}`
    : '',
].filter(Boolean).join('\n');

const mirrorDownloadUrl = (url) => (tauriToolDownloadMirror ? `${tauriToolDownloadMirror}/${url}` : '');
const tauriToolUrls = (url) => [url, mirrorDownloadUrl(url)].filter(Boolean);
const prefetchTauriTools = process.env.MAGPIE_LINUX_PREFETCH_TAURI_TOOLS !== '0';
const tauriToolDownloadRetries = process.env.MAGPIE_LINUX_TAURI_TOOL_DOWNLOAD_RETRIES ?? '2';
const tauriBundlerToolDownloads = [
  {
    name: 'AppRun-x86_64',
    urls: tauriToolUrls('https://github.com/tauri-apps/binary-releases/releases/download/apprun-old/AppRun-x86_64'),
  },
  {
    name: 'linuxdeploy-x86_64.AppImage',
    urls: tauriToolUrls('https://github.com/tauri-apps/binary-releases/releases/download/linuxdeploy/linuxdeploy-x86_64.AppImage'),
  },
  {
    name: 'linuxdeploy-plugin-gtk.sh',
    urls: tauriToolUrls('https://raw.githubusercontent.com/tauri-apps/linuxdeploy-plugin-gtk/master/linuxdeploy-plugin-gtk.sh'),
  },
  {
    name: 'linuxdeploy-plugin-gstreamer.sh',
    urls: tauriToolUrls('https://raw.githubusercontent.com/tauri-apps/linuxdeploy-plugin-gstreamer/master/linuxdeploy-plugin-gstreamer.sh'),
  },
  {
    name: 'linuxdeploy-plugin-appimage-x86_64.AppImage',
    urls: tauriToolUrls('https://github.com/linuxdeploy/linuxdeploy-plugin-appimage/releases/download/continuous/linuxdeploy-plugin-appimage-x86_64.AppImage'),
  },
];

const prefetchTauriBundlerToolsScript = prefetchTauriTools ? `
TAURI_CACHE_DIR=/root/.cache/tauri
TAURI_PREFETCH_MARKER="$TAURI_CACHE_DIR/magpie-linux-tools-x86_64.ready"
mkdir -p "$TAURI_CACHE_DIR"

prefetch_tauri_tool() {
  local output_name="$1"
  shift
  local output_path="$TAURI_CACHE_DIR/$output_name"
  local temp_path="$output_path.magpie-download"

  rm -f "$output_path" "$temp_path"
  for url in "$@"; do
    echo "预下载 Tauri AppImage 工具：$output_name"
    echo "下载地址：$url"
    if curl -fL --retry ${tauriToolDownloadRetries} --retry-all-errors --retry-delay 2 --connect-timeout 30 -o "$temp_path" "$url"; then
      mv "$temp_path" "$output_path"
      chmod +x "$output_path"
      return 0
    fi
    rm -f "$temp_path"
  done

  echo "无法下载 Tauri AppImage 工具：$output_name"
  return 1
}

if [ ! -f "$TAURI_PREFETCH_MARKER" ]; then
${tauriBundlerToolDownloads
  .map((tool) => `  prefetch_tauri_tool ${shellQuote(tool.name)} ${tool.urls.map(shellQuote).join(' ')}`)
  .join('\n')}
  touch "$TAURI_PREFETCH_MARKER"
fi
` : '';

const targets = {
  x64: {
    aliases: ['x64', 'x86_64', 'amd64'],
    dockerPlatform: 'linux/amd64',
    targetDir: 'x86_64_linux',
    label: 'Linux x64',
  },
};

const target = Object.values(targets).find((value) => value.aliases.includes(requestedTarget));
const containerName = `magpie-music-linux-build-${target?.targetDir ?? requestedTarget}-${Date.now()}`;

if (!target) {
  console.error(`未知 Linux 构建架构：${requestedTarget}`);
  console.error('可用架构：x64');
  process.exit(1);
}

const ensureDocker = () => {
  const versionResult = spawnSync(docker, ['--version'], { stdio: 'ignore' });
  if (versionResult.error || versionResult.status !== 0) {
    console.error('未检测到 Docker。请先安装并启动 Docker Desktop，或在 Linux 上安装 Docker Engine。');
    process.exit(1);
  }

  if (process.env.MAGPIE_DOCKER_DRY_RUN === '1') return;

  const infoResult = spawnSync(docker, ['info'], { stdio: 'ignore' });
  if (infoResult.error || infoResult.status !== 0) {
    console.error('已检测到 Docker CLI，但 Docker daemon 当前不可用。请先启动 Docker。');
    process.exit(1);
  }
};

const buildBuilderImage = () => {
  const args = [
    'build',
    '-f',
    dockerfilePath,
    '-t',
    builderImage,
    ...Object.entries(mirrorBuildArgs).flatMap(([key, value]) => ['--build-arg', `${key}=${value}`]),
    resolve(appDir, 'docker'),
  ];

  if (process.env.MAGPIE_DOCKER_DRY_RUN === '1') {
    console.log(`Docker builder image: ${builderImage}`);
    console.log(`使用国内镜像: ${useChinaMirrors ? '是' : '否'}`);
    console.log(`${docker} ${args.join(' ')}`);
    return;
  }

  console.log(`检查/构建 Docker Linux builder 镜像：${builderImage}`);
  console.log(`使用国内镜像：${useChinaMirrors ? '是' : '否'}`);
  const result = spawnSync(docker, args, {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const containerScript = ({ targetDir }) => `
set -euo pipefail

mkdir -p /workspace
tar \\
  --exclude=.git \\
  --exclude=node_modules \\
  --exclude='*/node_modules' \\
  --exclude=app/dist \\
  --exclude=app/src-tauri/target \\
  --exclude=packages/plugin-cli/dist \\
  --exclude=packages/plugin-types/dist \\
  --exclude='plugins/*/dist' \\
  -C /workspace-host \\
  -cf - . | tar -C /workspace -xf -

cd /workspace
${tauriBundlerMirrorEnv}
${prefetchTauriBundlerToolsScript}
pnpm config set store-dir /pnpm-store
pnpm install --frozen-lockfile
pnpm --filter @magpie-music/plugin-types build
pnpm --filter @magpie-music/plugin-cli build
cd app
CARGO_TARGET_DIR=/cargo-target/${targetDir} pnpm build:linux

rm -rf /workspace-host/app/src-tauri/target/${targetDir}/release/bundle
mkdir -p /workspace-host/app/src-tauri/target/${targetDir}/release
cp -a /cargo-target/${targetDir}/release/bundle /workspace-host/app/src-tauri/target/${targetDir}/release/
`;

ensureDocker();
buildBuilderImage();

const dockerArgs = [
  'run',
  '--rm',
  '--name',
  containerName,
  '--platform',
  target.dockerPlatform,
  '--label',
  'magpie-music.role=linux-build',
  '--label',
  `magpie-music.target=${target.targetDir}`,
  '-v',
  `${repoRoot}:/workspace-host`,
  '-v',
  'magpie-music-linux-pnpm-store:/pnpm-store',
  '-v',
  'magpie-music-linux-cargo-registry:/usr/local/cargo/registry',
  '-v',
  'magpie-music-linux-cargo-git:/usr/local/cargo/git',
  '-v',
  `magpie-music-linux-target-${target.targetDir}:/cargo-target`,
  '-v',
  'magpie-music-linux-tauri-cache:/root/.cache/tauri',
  '-e',
  'APPIMAGE_EXTRACT_AND_RUN=1',
  '-w',
  '/workspace',
  builderImage,
  'bash',
  '-lc',
  containerScript(target),
];

if (process.env.MAGPIE_DOCKER_DRY_RUN === '1') {
  console.log(`将构建 ${target.label} 安装包。`);
  console.log(`Docker platform: ${target.dockerPlatform}`);
  console.log(`产物目录: app/src-tauri/target/${target.targetDir}/release/bundle`);
  console.log(`${docker} ${dockerArgs.join(' ')}`);
  process.exit(0);
}

console.log(`开始在 Docker 中构建 ${target.label} 安装包...`);
console.log(`产物将复制到 app/src-tauri/target/${target.targetDir}/release/bundle`);

const result = spawnSync(docker, dockerArgs, {
  cwd: repoRoot,
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
