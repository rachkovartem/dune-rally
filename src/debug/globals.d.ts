export {};

declare global {
  interface Window {
    __dbg?: () => unknown;
    __tp?: (x: number, z: number) => void;
    __render?: { backend: string };
  }
}
