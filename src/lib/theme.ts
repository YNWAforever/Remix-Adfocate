export type WorkspaceTheme = Record<string, string>;

export function applyTheme(theme: WorkspaceTheme) {
  const map: Record<string, string> = {
    primary: "--color-acid",
    secondary: "--color-magenta",
    accent: "--color-violet",
  };
  for (const [key, value] of Object.entries(theme)) {
    const cssVar = map[key];
    if (cssVar) document.documentElement.style.setProperty(cssVar, value);
  }
}
