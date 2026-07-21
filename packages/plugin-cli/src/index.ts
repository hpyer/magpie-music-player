#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import type { PluginConfigSchema, PluginManifest } from '@magpie-music/plugin-types';

export type CreateOptions = {
  language: 'ts' | 'js';
  directory?: string;
  id?: string;
  displayName?: string;
  template?: string;
};

const command = process.argv[2] ?? 'help';
const args = process.argv.slice(3);
const defaultTemplateRepos = [
  'https://gitee.com/Hpyer/magpie-music-player.git',
  'https://github.com/hpyer/magpie-music-player.git',
];

const usage = () => {
  console.log(`用法：
  magpie-music create <name> [--ts|--js] [--dir <path>] [--id <plugin-id>] [--name <display-name>] [--template <git-url>]
  magpie-music test [plugin-dir]
  magpie-music build [plugin-dir]
`);
};

export const sanitizePackageName = (name: string) => (
  name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'magpie-music-plugin'
);

export const defaultPluginId = (name: string) => `local.magpie.${sanitizePackageName(name).replace(/[^a-z0-9]+/g, '-')}`;

export const parseCreateOptions = (values: string[]): { name: string; options: CreateOptions } => {
  const name = values[0];
  if (!name || name.startsWith('-')) {
    throw new Error('缺少插件名称。');
  }

  const options: CreateOptions = { language: 'ts' };
  const readOptionValue = (optionName: string, index: number) => {
    const optionValue = values[index + 1];
    if (!optionValue || optionValue.startsWith('-')) {
      throw new Error(`${optionName} 需要提供参数值。`);
    }
    return optionValue;
  };

  for (let index = 1; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--ts') {
      options.language = 'ts';
    } else if (value === '--js') {
      options.language = 'js';
    } else if (value === '--dir') {
      options.directory = readOptionValue(value, index);
      index += 1;
    } else if (value === '--id') {
      options.id = readOptionValue(value, index);
      index += 1;
    } else if (value === '--name') {
      options.displayName = readOptionValue(value, index);
      index += 1;
    } else if (value === '--template' || value === '--template-repo') {
      options.template = readOptionValue(value, index);
      index += 1;
    } else {
      throw new Error(`未知选项：${value}`);
    }
  }

  return { name, options };
};

const pluginDirArg = () => {
  const positional = args.find(value => !value.startsWith('-'));
  return resolve(process.cwd(), positional ?? '.');
};

const manifestPath = (pluginDir: string) => resolve(pluginDir, 'plugin.json');

const readManifest = async (pluginDir: string): Promise<PluginManifest> => (
  JSON.parse(await readFile(manifestPath(pluginDir), 'utf8')) as PluginManifest
);

const writeManifest = async (pluginDir: string, manifest: PluginManifest) => {
  await writeFile(manifestPath(pluginDir), `${JSON.stringify(manifest, null, 2)}\n`);
};

const sha256File = async (filePath: string) => {
  const bytes = await readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex');
};

// 构建完成后把入口文件哈希写回 plugin.json，安装器会用它做完整性校验。
const updateEntryHash = async (pluginDir: string) => {
  const manifest = await readManifest(pluginDir);
  if (!manifest.entry) throw new Error('plugin.json 必须声明 entry 入口文件。');

  const entryPath = resolve(pluginDir, manifest.entry);
  if (!existsSync(entryPath)) throw new Error(`入口文件不存在：${manifest.entry}`);

  manifest.integrity = {
    ...manifest.integrity,
    algorithm: 'sha256',
    entry: await sha256File(entryPath),
  };

  await writeManifest(pluginDir, manifest);
  console.log(`已更新 plugin.json integrity.entry：${manifest.integrity.entry}`);
  return manifest;
};

// JavaScript 模板不需要 TypeScript 编译，直接复制源码到 dist。
const copyJsBuild = async (pluginDir: string) => {
  const sourceDir = resolve(pluginDir, 'src');
  const outputDir = resolve(pluginDir, 'dist');
  if (!existsSync(sourceDir)) throw new Error('src 目录不存在。');
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  await cp(sourceDir, outputDir, {
    recursive: true,
    filter: source => source.endsWith('.js') || !source.includes('.'),
  });
  console.log(`已复制 JavaScript 源码到 ${relative(pluginDir, outputDir)}`);
};

// 插件目录存在 tsconfig.json 时走 tsc，否则按纯 JavaScript 插件处理。
const compilePlugin = async (pluginDir: string) => {
  if (existsSync(resolve(pluginDir, 'tsconfig.json'))) {
    const result = spawnSync('pnpm', ['exec', 'tsc', '--project', 'tsconfig.json'], {
      cwd: pluginDir,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`tsc 执行失败，退出码：${result.status}`);
    return;
  }

  await copyJsBuild(pluginDir);
};

// 发布包只包含安装需要的清单、构建产物和可选资源。
const zipPackage = async (pluginDir: string, manifest: PluginManifest) => {
  const releaseDir = resolve(pluginDir, 'release');
  const packageName = `${manifest.id}-${manifest.version}.zip`.replace(/[^a-zA-Z0-9._-]/g, '-');
  const packagePath = join(releaseDir, packageName);
  const includePaths = ['plugin.json'];

  if (existsSync(resolve(pluginDir, 'dist'))) includePaths.push('dist');
  if (existsSync(resolve(pluginDir, 'assets'))) includePaths.push('assets');
  if (existsSync(resolve(pluginDir, 'SIGNATURE'))) includePaths.push('SIGNATURE');

  await mkdir(releaseDir, { recursive: true });
  await rm(packagePath, { force: true });

  const result = spawnSync('zip', ['-r', '-X', packagePath, ...includePaths], {
    cwd: pluginDir,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`zip 执行失败，退出码：${result.status}`);

  console.log(`已创建插件包：${packagePath}`);
};

export const validateConfigSchema = (value: unknown): PluginConfigSchema => {
  const fields = Array.isArray(value)
    ? value
    : (value && typeof value === 'object' ? (value as { fields?: unknown }).fields : undefined);
  if (!Array.isArray(fields)) throw new Error('installation.config-schema 必须返回 { fields: [...] }。');
  for (const field of fields) {
    if (!field || typeof field !== 'object') throw new Error('配置字段必须是对象。');
    const candidate = field as { key?: unknown; label?: unknown; type?: unknown };
    if (typeof candidate.key !== 'string') throw new Error('配置字段缺少 key。');
    if (typeof candidate.label !== 'string') throw new Error(`配置字段 ${candidate.key} 缺少 label。`);
    if (!['text', 'password', 'url', 'number', 'boolean', 'select'].includes(String(candidate.type))) {
      throw new Error(`配置字段 ${candidate.key} 使用了不支持的类型。`);
    }
  }
  return { fields: fields as PluginConfigSchema['fields'] };
};

// 测试命令会构建插件、校验入口哈希，并调用安装配置消息检查基础运行时契约。
const testPlugin = async (pluginDir: string) => {
  await compilePlugin(pluginDir);
  const manifest = await readManifest(pluginDir);
  const entryPath = resolve(pluginDir, manifest.entry);
  if (!existsSync(entryPath)) throw new Error(`入口文件不存在：${manifest.entry}`);

  if (manifest.integrity?.entry) {
    const actualHash = await sha256File(entryPath);
    if (actualHash !== manifest.integrity.entry) {
      throw new Error(`入口文件哈希不匹配。期望 ${manifest.integrity.entry}，实际 ${actualHash}。`);
    }
  }

  if (manifest.runtime !== 'web-worker-esm') {
    console.log(`运行时 ${manifest.runtime} 不需要模块导入校验，已跳过。`);
    return;
  }

  const moduleUrl = pathToFileURL(entryPath);
  moduleUrl.searchParams.set('t', String(Date.now()));
  const pluginModule = await import(moduleUrl.href) as { handleMessage?: (message: unknown) => Promise<unknown> | unknown };
  if (typeof pluginModule.handleMessage !== 'function') {
    throw new Error('插件入口模块必须导出 handleMessage(message)。');
  }

  validateConfigSchema(await pluginModule.handleMessage({ type: 'installation.config-schema' }));
  console.log(`插件 ${manifest.id} 校验通过。`);
};

const buildPlugin = async (pluginDir: string) => {
  await compilePlugin(pluginDir);
  const manifest = await updateEntryHash(pluginDir);
  await zipPackage(pluginDir, manifest);
};

const copyTemplate = async (
  sourceDir: string,
  outputDir: string,
  replacements: Record<string, string>,
  allowExisting = false,
) => {
  if (!allowExisting && existsSync(outputDir)) throw new Error(`目标目录已存在：${outputDir}`);
  await mkdir(outputDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  const ignoredEntries = new Set(['.git', 'node_modules', 'dist', 'release']);
  for (const entry of entries) {
    if (ignoredEntries.has(entry.name)) continue;

    const source = join(sourceDir, entry.name);
    const target = join(outputDir, entry.name);
    if (entry.isDirectory()) {
      await copyTemplate(source, target, replacements, true);
      continue;
    }

    const fileStat = await stat(source);
    if (!fileStat.isFile()) continue;
    let content = await readFile(source, 'utf8');
    for (const [key, value] of Object.entries(replacements)) {
      content = content.replaceAll(key, value);
    }
    await writeFile(target, content);
  }
};

// 默认优先从 Gitee 克隆模板仓库，GitHub 作为兜底；也支持用户显式传入模板仓库。
const cloneTemplateRepo = async (templateUrl: string | undefined) => {
  const urls = templateUrl ? [templateUrl] : defaultTemplateRepos;
  const errors: string[] = [];

  for (const url of urls) {
    const cloneDir = await mkdtemp(join(tmpdir(), 'magpie-music-template-'));
    const result = spawnSync('git', ['clone', '--depth', '1', url, cloneDir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (!result.error && result.status === 0) {
      return { cloneDir, url };
    }

    const message = result.error?.message ?? (result.stderr.trim() || `git 执行失败，退出码：${result.status}`);
    errors.push(`${url}: ${message}`);
    await rm(cloneDir, { recursive: true, force: true });
  }

  throw new Error(`无法获取插件模板仓库。\n${errors.join('\n')}`);
};

const isTemplateDirectory = (directory: string) => (
  existsSync(join(directory, 'package.json')) && existsSync(join(directory, 'plugin.json'))
);

const resolveTemplateDirectory = (repoDir: string, language: CreateOptions['language']) => {
  const candidates = [
    join(repoDir, 'plugins', `template-${language}`),
    join(repoDir, `template-${language}`),
    join(repoDir, 'templates', language),
    repoDir,
  ];

  const templateDirectory = candidates.find(isTemplateDirectory);
  if (!templateDirectory) {
    throw new Error(`模板仓库不包含 ${language.toUpperCase()} 插件模板。`);
  }

  return templateDirectory;
};

// create 命令会拉取模板仓库，并替换插件 id、展示名称和包名占位符。
const createPlugin = async (values: string[]) => {
  const { name, options } = parseCreateOptions(values);
  const packageName = sanitizePackageName(name);
  const outputDir = resolve(process.cwd(), options.directory ?? packageName);
  const id = options.id ?? defaultPluginId(name);
  const displayName = options.displayName ?? name;

  const { cloneDir, url } = await cloneTemplateRepo(options.template);
  try {
    await copyTemplate(resolveTemplateDirectory(cloneDir, options.language), outputDir, {
      __PLUGIN_ID__: id,
      __PLUGIN_NAME__: displayName,
      __PACKAGE_NAME__: packageName,
    });
  } finally {
    await rm(cloneDir, { recursive: true, force: true });
  }

  console.log(`已创建 ${options.language.toUpperCase()} 插件模板：${outputDir}`);
  console.log(`模板来源：${url}`);
};

export const main = async () => {
  if (command === 'help' || command === '--help' || command === '-h') {
    usage();
    return;
  }

  if (command === 'create') {
    await createPlugin(args);
  } else if (command === 'test') {
    await testPlugin(pluginDirArg());
  } else if (command === 'build') {
    await buildPlugin(pluginDirArg());
  } else {
    usage();
    process.exitCode = 1;
  }
};

const isDirectRun = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectRun) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
