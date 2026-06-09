import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type ThemeContextValue = {
  dark: boolean;
  setDark: (value: boolean) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

// App-wide theme state. Defaults to light mode and applies the `dark` class on
// the document root whenever the choice changes, so a single source of truth
// stays consistent across every route. No persistence (localStorage/cookies)
// because the app runs in sandboxed iframes where storage is unavailable.
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    if (dark) root.classList.add("dark");
    else root.classList.remove("dark");
  }, [dark]);
  return (
    <ThemeContext.Provider value={{ dark, setDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
