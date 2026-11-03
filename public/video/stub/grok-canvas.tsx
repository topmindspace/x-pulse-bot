import * as React from "react";
export const useEffect = React.useEffect;
export const useRef = React.useRef;
export const useState = React.useState;
export function useGrokTheme(): any {
  const f = (s: number) => ({ fontSize: s });
  return {
    font: { family: "sans-serif", heading2: f(24), subtext: f(13), label: f(12), caption: f(12) },
    bg: { base: "#0b0f19" },
    text: { primary: "#fff", secondary: "#bbb", tertiary: "#888" },
    border: { subtle: "#333" },
    weight: { semibold: 600 },
  };
}
export function Toggle(p: { label: string; value: boolean; onChange: (on: boolean) => void }) {
  return React.createElement("label", { "data-toggle": p.label }, React.createElement("input", { type: "checkbox", checked: p.value, onChange: (e: any) => p.onChange(e.target.checked) }), p.label);
}
