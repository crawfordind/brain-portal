export type ThemeMode = "light" | "dark";

export interface Theme {
  id: string;
  label: string;
  description: string;
  mode: ThemeMode;
  preview: {
    bg: string;
    surface: string;
    accent: string;
    text: string;
  };
}

export const themes: Theme[] = [
  {
    id: "light",
    label: "Canvas",
    description: "Clean & bright",
    mode: "light",
    preview: {
      bg: "#ffffff",
      surface: "#f5f5f5",
      accent: "#2d7a56",
      text: "#1a1a22",
    },
  },
  {
    id: "dark",
    label: "Slate",
    description: "Deep & focused",
    mode: "dark",
    preview: {
      bg: "#1c1c1e",
      surface: "#2a2a2e",
      accent: "#4db6ac",
      text: "#f0f0f5",
    },
  },
];

export function getThemeById(id: string): Theme | undefined {
  return themes.find((t) => t.id === id);
}
