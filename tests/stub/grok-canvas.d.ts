declare module "grok/canvas" {
  import * as R from "react";
  export const useEffect: typeof R.useEffect;
  export const useRef: typeof R.useRef;
  export const useState: typeof R.useState;
  export type ChangeEvent<T> = R.ChangeEvent<T>;
  export type PointerEvent<T> = R.PointerEvent<T>;
  export function useGrokTheme(): any;
  export function Toggle(p: { label: string; value: boolean; onChange: (on: boolean) => void }): R.ReactElement;
}
