// src/ui/duelHud.test.ts
import { describe, it, expect } from 'vitest';
import { formatRaceTime, DuelHud } from './duelHud';

describe('formatRaceTime', () => {
  it('formats zero or invalid time as dashes', () => {
    expect(formatRaceTime(0)).toBe('--:--.--');
    expect(formatRaceTime(-100)).toBe('--:--.--');
    expect(formatRaceTime(NaN)).toBe('--:--.--');
    expect(formatRaceTime(Infinity)).toBe('--:--.--');
  });

  it('formats seconds and hundredths correctly', () => {
    // 5.25 seconds = 5250 ms -> 00:05.25
    expect(formatRaceTime(5250)).toBe('00:05.25');
    // 59.99 seconds = 59990 ms -> 00:59.99
    expect(formatRaceTime(59990)).toBe('00:59.99');
  });

  it('formats minutes and hundredths correctly', () => {
    // 1 minute 14.82 seconds = 74820 ms -> 01:14.82
    expect(formatRaceTime(74820)).toBe('01:14.82');
    // 10 minutes 0.05 seconds = 600050 ms -> 10:00.05
    expect(formatRaceTime(600050)).toBe('10:00.05');
  });
});

describe('DuelHud in headless/Node environment', () => {
  it('instantiates and disposes safely without DOM', () => {
    const fakeContainer = {} as HTMLElement;
    const hud = new DuelHud(fakeContainer);
    expect(hud.isRacing()).toBe(false);
    expect(hud.isAnyModalOpen()).toBe(false);

    // Calling public methods should not crash in Node
    hud.showProximityPrompt('p1', 'Racer1', 25);
    hud.hideProximityPrompt();
    hud.openTrackSelector();
    hud.closeTrackSelector();
    hud.showWaiting('p1', 'Racer1');
    hud.cancelWaiting();
    hud.hideIncomingInvite();
    hud.hideRaceHud();
    hud.hideResultModal();
    hud.hideAllModals();
    hud.destroy();
  });
});
