let loading: Promise<void> | undefined;

// Keep asset loading within the existing four-connection local bridge budget.
// FontFace registration preserves the same self-hosted variable font stacks.
export function loadWorkbenchFonts(): Promise<void> {
  if (typeof FontFace === "undefined" || !document.fonts) return Promise.resolve();
  if (loading) return loading;
  document.documentElement.dataset.fonts = "loading";
  loading = (async () => {
    await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>(".axis-brandmark img"), image => image.decode().catch(() => undefined)));
    for (const [family, file, weight] of [
      ["Inter", "inter-latin-variable.woff2", "100 900"],
      ["Newsreader", "newsreader-latin-variable.woff2", "200 800"],
      ["JetBrains Mono", "jetbrains-mono-latin-variable.woff2", "100 800"],
    ]) {
      const face = new FontFace(family, `url(/fonts/${file})`, { style: "normal", weight, display: "swap" });
      document.fonts.add(await face.load());
    }
    document.documentElement.dataset.fonts = "ready";
  })().catch(() => {
    document.documentElement.dataset.fonts = "error";
  });
  return loading;
}
