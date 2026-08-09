export function getSiteCopyright(suffix = ''): string {
  return `© ${String(new Date().getFullYear())} BountyEscrow${suffix}`;
}
