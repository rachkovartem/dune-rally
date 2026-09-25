// src/ui/cameraModeBanner.ts
// The camera mode's name, shown in the HUD for a moment after the player switches.

export const CAMERA_BANNER_SECONDS = 1.5;

export interface CameraModeBanner {
  show(text: string): void;
}

export function createCameraModeBanner(element: HTMLElement): CameraModeBanner {
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  return {
    show(text) {
      element.textContent = text;
      element.classList.add('is-visible');
      if (hideTimer !== null) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        element.classList.remove('is-visible');
        hideTimer = null;
      }, CAMERA_BANNER_SECONDS * 1000);
    },
  };
}
