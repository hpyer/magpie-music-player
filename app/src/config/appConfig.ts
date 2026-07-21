import type { PluginCapability } from '../types/plugin';
import type { SettingsTab, ThemeOption } from '../types/ui';

export const officialCacheAllowedSourceIds = [
  'cn.hpyer.magpie.navidrome',
];

export const themeOptions: ThemeOption[] = [
  {
    id: 'sunset',
    name: '日落水色',
    background: 'radial-gradient(circle at 78% 60%, rgba(0, 72, 78, 0.5), transparent 36%), linear-gradient(150deg, #ff7a3d 0%, #f4b18e 32%, #54bacb 62%, #00606b 100%)',
    panel: 'rgba(246, 250, 250, 0.28)',
    ink: '#0b1214',
    mutedInk: 'rgba(11, 18, 20, 0.62)',
    control: '#05090a',
    controlInk: '#ffffff',
  },
  {
    id: 'graphite',
    name: '石墨银',
    background: 'radial-gradient(circle at 80% 20%, rgba(236, 241, 242, 0.42), transparent 35%), linear-gradient(150deg, #dfe6e8 0%, #aebbc0 38%, #5f7178 72%, #1d272b 100%)',
    panel: 'rgba(255, 255, 255, 0.24)',
    ink: '#081012',
    mutedInk: 'rgba(8, 16, 18, 0.6)',
    control: '#11191d',
    controlInk: '#ffffff',
  },
  {
    id: 'aurora',
    name: '极光绿',
    background: 'radial-gradient(circle at 24% 26%, rgba(224, 255, 181, 0.46), transparent 34%), linear-gradient(150deg, #e8f28d 0%, #7bd6a7 36%, #3b9aa4 68%, #17363e 100%)',
    panel: 'rgba(245, 255, 246, 0.28)',
    ink: '#061413',
    mutedInk: 'rgba(6, 20, 19, 0.62)',
    control: '#061413',
    controlInk: '#ffffff',
  },
  {
    id: 'orchid',
    name: '莓果紫',
    background: 'radial-gradient(circle at 82% 66%, rgba(255, 219, 167, 0.4), transparent 34%), linear-gradient(150deg, #fb8aa1 0%, #d58bd9 38%, #7aa3dc 70%, #28405f 100%)',
    panel: 'rgba(255, 246, 252, 0.28)',
    ink: '#160d18',
    mutedInk: 'rgba(22, 13, 24, 0.62)',
    control: '#160d18',
    controlInk: '#ffffff',
  },
  {
    id: 'paper',
    name: '纸本白',
    background: '#f3f0e8',
    panel: 'rgba(23, 18, 15, 0.075)',
    ink: '#17120f',
    mutedInk: 'rgba(23, 18, 15, 0.58)',
    control: '#17120f',
    controlInk: '#ffffff',
  },
  {
    id: 'midnight',
    name: '午夜黑',
    background: '#111318',
    panel: 'rgba(255, 255, 255, 0.12)',
    ink: '#f4f0e8',
    mutedInk: 'rgba(244, 240, 232, 0.66)',
    control: '#f4f0e8',
    controlInk: '#111318',
    iconFilter: 'brightness(0) invert(1)',
    playIconFilter: 'brightness(0) saturate(100%)',
    rangeTrack: 'rgba(255, 255, 255, 0.28)',
    line: 'rgba(255, 255, 255, 0.18)',
    panelHeader: 'rgba(255, 255, 255, 0.08)',
    field: 'rgba(255, 255, 255, 0.1)',
    fieldHover: 'rgba(255, 255, 255, 0.16)',
    rowActive: 'rgba(255, 255, 255, 0.16)',
    modalBackground: '#171a20',
    modalBorder: 'rgba(255, 255, 255, 0.14)',
  },
];

export const settingsTabs: Array<{ value: SettingsTab; label: string }> = [
  { value: 'theme', label: '主题' },
  { value: 'plugins', label: '插件' },
  { value: 'shortcuts', label: '快捷键' },
  { value: 'cache', label: '缓存' },
  { value: 'about', label: '关于' },
];

export const pluginCapabilityGroups: Array<{ label: string; capabilities: PluginCapability[] }> = [
  { label: '远程歌单', capabilities: ['playlist-source'] },
  { label: '歌词搜索', capabilities: ['lyrics-search'] },
  { label: '歌曲信息搜索', capabilities: ['song-info-search'] },
  { label: '歌曲搜索', capabilities: ['search', 'music-search'] },
  { label: '远程删除', capabilities: ['media-delete'] },
];
