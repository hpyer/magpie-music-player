import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import {
  defaultPluginId,
  parseCreateOptions,
  sanitizePackageName,
  validateConfigSchema,
} from '../dist/index.js';

describe('@magpie-music/plugin-cli', () => {
  it('清洗 npm 包名并生成默认插件 id', () => {
    assert.equal(sanitizePackageName(' My Cool 插件! '), 'my-cool');
    assert.equal(sanitizePackageName('   '), 'magpie-music-plugin');
    assert.equal(defaultPluginId(' My Cool 插件! '), 'local.magpie.my-cool');
  });

  it('解析 create 命令参数', () => {
    assert.deepEqual(parseCreateOptions([
      'demo',
      '--js',
      '--dir',
      'plugins/demo',
      '--id',
      'com.example.demo',
      '--name',
      'Demo Plugin',
      '--template',
      'file:///tmp/template.git',
    ]), {
      name: 'demo',
      options: {
        language: 'js',
        directory: 'plugins/demo',
        id: 'com.example.demo',
        displayName: 'Demo Plugin',
        template: 'file:///tmp/template.git',
      },
    });
  });

  it('拒绝缺少值的 create 选项', () => {
    assert.throws(
      () => parseCreateOptions(['demo', '--dir']),
      /需要提供参数值/,
    );
  });

  it('校验插件安装配置 schema', () => {
    assert.deepEqual(validateConfigSchema({
      fields: [
        { key: 'serverUrl', label: '服务地址', type: 'url', required: true },
        { key: 'enabled', label: '启用', type: 'boolean' },
      ],
    }), {
      fields: [
        { key: 'serverUrl', label: '服务地址', type: 'url', required: true },
        { key: 'enabled', label: '启用', type: 'boolean' },
      ],
    });

    assert.throws(
      () => validateConfigSchema({ fields: [{ key: 'bad', label: '错误', type: 'date' }] }),
      /不支持的类型/,
    );
  });

  it('输出中文帮助信息', () => {
    const result = spawnSync(process.execPath, ['dist/index.js', '--help'], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /用法/);
    assert.match(result.stdout, /magpie-music create/);
  });
});
