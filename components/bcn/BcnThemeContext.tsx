"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { BrandingTokens } from "@/lib/branding/resolve-theme";
import { defaultWordmark } from "@/components/bcn/brand/BcnBrandMarks";

const BcnThemeContext = createContext<BrandingTokens | null>(null);

export function BcnThemeProvider({
  theme,
  children,
}: {
  theme: BrandingTokens;
  children: ReactNode;
}) {
  return (
    <BcnThemeContext.Provider value={theme}>{children}</BcnThemeContext.Provider>
  );
}

export function useBcnTheme(): BrandingTokens {
  const theme = useContext(BcnThemeContext);
  if (!theme) {
    throw new Error("useBcnTheme requires BcnThemeProvider");
  }
  return theme;
}

export function useBcnThemeOptional(): BrandingTokens {
  const theme = useContext(BcnThemeContext);
  return (
    theme ?? {
      dataBrand: "bcn3",
      cssVars: {},
      tokenOverrides: {},
      logoUrl: null,
      wordmark: defaultWordmark("bcn3"),
    }
  );
}
