import { getInitialTheme, resolveTheme, THEME_COLORS } from "@/utils/theme";

// Full-viewport splash shown while identity/instance initialization is in
// flight. Visually identical to the inline splash embedded in index.html, so
// the handoff HTML splash -> React splash -> app has no flash or jump.
const SplashScreen = () => {
  const background = THEME_COLORS[resolveTheme(getInitialTheme())];
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background,
        zIndex: 50,
      }}
    >
      <img src="/logo.webp" alt="" width={72} height={72} className="animate-pulse" />
    </div>
  );
};

export default SplashScreen;
