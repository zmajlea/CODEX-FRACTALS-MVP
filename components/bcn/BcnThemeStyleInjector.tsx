"use client";

import { useBcnThemeOptional } from "@/components/bcn/BcnThemeContext";
import { themeToAppOverrideBlock } from "@/lib/branding/resolve-theme";

/** Keeps #app override CSS in sync when the active grant / module theme changes. */
export function BcnThemeStyleInjector() {
  const theme = useBcnThemeOptional();
  const block = themeToAppOverrideBlock(theme.dataBrand, theme.tokenOverrides);
  if (!block) return null;
  return <style>{block}</style>;
}
