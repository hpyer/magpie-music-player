export const pathJoin = (dir: string, child: string) => {
  const separator = dir.includes('\\') ? '\\' : '/';
  return `${dir.replace(/[\\/]+$/, '')}${separator}${child}`;
};
