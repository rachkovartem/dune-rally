// src/ui/duelHud.ts
import { DUEL_TRACKS, type DuelTrackDef, type DuelTrackId } from '../../shared/duelTracks';

export interface DuelResultDisplayData {
  won: boolean;
  trackName: string;
  winnerName: string;
  winnerTimeMs: number;
  loserName: string;
  loserTimeMs?: number;
  forfeit?: boolean;
}

export interface DuelHudCallbacks {
  onStartDuelInvite?: (opponentId: string, trackId: DuelTrackId) => void;
  onAcceptInvite?: (inviteId: string) => void;
  onDeclineInvite?: (inviteId: string) => void;
  onCancelInvite?: (opponentId: string) => void;
}

export function formatRaceTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '--:--.--';
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const hundredths = Math.floor((ms % 1000) / 10);
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${hundredths.toString().padStart(2, '0')}`;
}

export function playAudioBeep(freq = 440, duration = 0.12, type: OscillatorType = 'sine'): void {
  try {
    if (typeof window === 'undefined') return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch {
    // audio context might be restricted or unsupported
  }
}

export class DuelHud {
  private promptEl: HTMLElement | null = null;
  private trackModalEl: HTMLElement | null = null;
  private inviteModalEl: HTMLElement | null = null;
  private waitingModalEl: HTMLElement | null = null;
  private countdownEl: HTMLElement | null = null;
  private raceHudEl: HTMLElement | null = null;
  private resultModalEl: HTMLElement | null = null;

  private currentNearbyOpponentId: string | null = null;
  private currentNearbyOpponentName = '';
  private selectedOpponentId: string | null = null;
  private selectedOpponentName = '';
  private currentInviteId: string | null = null;
  private waitingTargetOpponentId: string | null = null;

  private countdownTimer: number | null = null;
  private inviteTimer: number | null = null;

  constructor(
    private container: HTMLElement,
    private callbacks: DuelHudCallbacks = {},
  ) {
    this.createDomElements();
    this.bindKeyboard();
  }

  private createDomElements(): void {
    if (typeof document === 'undefined') return;

    // 1. Proximity Prompt
    this.promptEl = document.createElement('div');
    this.promptEl.id = 'hud-duel-prompt';
    this.promptEl.hidden = true;
    this.promptEl.innerHTML = `
      <div class="duel-prompt-pill">
        <span class="duel-prompt-key"><kbd>F</kbd></span>
        <span class="duel-prompt-text">Вызов на дуэль: <b class="duel-opponent-name">Соперник</b> (<span class="duel-opponent-dist">--</span> м)</span>
      </div>
    `;
    this.promptEl.onclick = () => this.handlePromptClick();
    this.container.appendChild(this.promptEl);

    // 2. Track Selector Modal
    this.trackModalEl = document.createElement('div');
    this.trackModalEl.id = 'hud-duel-track-modal';
    this.trackModalEl.className = 'duel-modal-backdrop';
    this.trackModalEl.hidden = true;
    this.container.appendChild(this.trackModalEl);

    // 3. Waiting for opponent modal
    this.waitingModalEl = document.createElement('div');
    this.waitingModalEl.id = 'hud-duel-waiting';
    this.waitingModalEl.className = 'duel-modal-backdrop';
    this.waitingModalEl.hidden = true;
    this.container.appendChild(this.waitingModalEl);

    // 4. Incoming Invite Modal
    this.inviteModalEl = document.createElement('div');
    this.inviteModalEl.id = 'hud-duel-invite';
    this.inviteModalEl.className = 'duel-modal-backdrop';
    this.inviteModalEl.hidden = true;
    this.container.appendChild(this.inviteModalEl);

    // 5. Countdown Banner
    this.countdownEl = document.createElement('div');
    this.countdownEl.id = 'hud-duel-countdown';
    this.countdownEl.hidden = true;
    this.container.appendChild(this.countdownEl);

    // 6. In-Race HUD
    this.raceHudEl = document.createElement('div');
    this.raceHudEl.id = 'hud-duel-race';
    this.raceHudEl.hidden = true;
    this.container.appendChild(this.raceHudEl);

    // 7. Post-Race Result Modal
    this.resultModalEl = document.createElement('div');
    this.resultModalEl.id = 'hud-duel-result';
    this.resultModalEl.className = 'duel-modal-backdrop';
    this.resultModalEl.hidden = true;
    this.container.appendChild(this.resultModalEl);
  }

  private bindKeyboard(): void {
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', (e) => {
      // Don't intercept if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const key = e.key.toUpperCase();
      const code = e.code;
      const isF = key === 'F' || code === 'KeyF' || key === 'А';
      const isY = key === 'Y' || code === 'KeyY' || key === 'Н';
      const isN = key === 'N' || code === 'KeyN' || key === 'Т';

      // Proximity challenge trigger [F]
      if (isF && this.promptEl && !this.promptEl.hidden && this.currentNearbyOpponentId) {
        e.preventDefault();
        this.openTrackSelector();
        return;
      }

      // Invite response [Y] or [N]
      if (this.inviteModalEl && !this.inviteModalEl.hidden && this.currentInviteId) {
        if (isY) {
          e.preventDefault();
          this.acceptCurrentInvite();
          return;
        }
        if (isN) {
          e.preventDefault();
          this.declineCurrentInvite();
          return;
        }
      }

      // Cancel modal with [Escape]
      if (e.key === 'Escape') {
        if (this.trackModalEl && !this.trackModalEl.hidden) {
          this.closeTrackSelector();
        } else if (this.waitingModalEl && !this.waitingModalEl.hidden) {
          this.cancelWaiting();
        } else if (this.resultModalEl && !this.resultModalEl.hidden) {
          this.hideResultModal();
        }
      }
    });
  }

  // --- Proximity Prompt ---

  showProximityPrompt(opponentId: string, opponentName: string, distanceMeters: number): void {
    // If we're currently in a race or modal, ignore
    if (this.isRacing() || this.isAnyModalOpen()) return;

    this.currentNearbyOpponentId = opponentId;
    this.currentNearbyOpponentName = opponentName;

    if (this.promptEl) {
      const nameEl = this.promptEl.querySelector('.duel-opponent-name');
      const distEl = this.promptEl.querySelector('.duel-opponent-dist');
      if (nameEl) nameEl.textContent = opponentName;
      if (distEl) distEl.textContent = Math.round(distanceMeters).toString();
      this.promptEl.hidden = false;
    }
  }

  hideProximityPrompt(): void {
    this.currentNearbyOpponentId = null;
    if (this.promptEl) {
      this.promptEl.hidden = true;
    }
  }

  private handlePromptClick(): void {
    if (this.currentNearbyOpponentId) {
      this.openTrackSelector();
    }
  }

  // --- Track Selector ---

  openTrackSelector(): void {
    if (!this.currentNearbyOpponentId || !this.trackModalEl) return;
    const opponentName = this.currentNearbyOpponentName;
    const opponentId = this.currentNearbyOpponentId;
    this.selectedOpponentId = opponentId;
    this.selectedOpponentName = opponentName;
    this.hideProximityPrompt();

    this.trackModalEl.innerHTML = `
      <div class="duel-modal-card">
        <div class="duel-modal-header">
          <div class="duel-modal-title">🏆 ВЫЗОВ НА ГОНКУ</div>
          <button type="button" class="duel-modal-close" id="duel-track-close">✕</button>
        </div>
        <div class="duel-modal-sub">Соперник: <b style="color:#ffd23d">${opponentName}</b></div>
        <div class="duel-tracks-list">
          ${DUEL_TRACKS.map((t) => `
            <div class="duel-track-card" data-track-id="${t.id}">
              <div class="duel-track-header">
                <span class="duel-track-badge">${t.badge}</span>
                <span class="duel-track-name">${t.name}</span>
                <span class="duel-track-dist">${t.distanceMeters} м</span>
              </div>
              <div class="duel-track-sub">${t.subtitle}</div>
              <button type="button" class="duel-select-btn" data-track-id="${t.id}">Бросить вызов 🏁</button>
            </div>
          `).join('')}
        </div>
        <div class="duel-modal-footer">
          <span style="opacity:0.75"><kbd>Esc</kbd> — отмена</span>
        </div>
      </div>
    `;

    const closeBtn = this.trackModalEl.querySelector('#duel-track-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.closeTrackSelector());

    const trackCards = this.trackModalEl.querySelectorAll('.duel-track-card');
    trackCards.forEach((card) => {
      card.addEventListener('click', () => {
        const trackId = (card as HTMLElement).dataset.trackId as DuelTrackId;
        const targetId = this.selectedOpponentId ?? opponentId;
        const targetName = this.selectedOpponentName ?? opponentName;
        if (trackId && targetId) {
          this.closeTrackSelector();
          this.showWaiting(targetId, targetName);
          this.callbacks.onStartDuelInvite?.(targetId, trackId);
        }
      });
    });

    this.trackModalEl.hidden = false;
  }

  closeTrackSelector(): void {
    this.selectedOpponentId = null;
    this.selectedOpponentName = '';
    if (this.trackModalEl) {
      this.trackModalEl.hidden = true;
    }
  }

  // --- Waiting Modal ---

  showWaiting(opponentId: string, opponentName: string): void {
    this.waitingTargetOpponentId = opponentId;
    if (!this.waitingModalEl) return;

    this.waitingModalEl.innerHTML = `
      <div class="duel-modal-card duel-card-small">
        <div class="duel-modal-title" style="font-size:22px">⏳ Ожидание ответа…</div>
        <div style="margin: 16px 0; font-size: 16px;">
          Вызов отправлен гонщику <b style="color:#ffd23d">${opponentName}</b>
        </div>
        <div class="duel-loading-dots">Ждём подтверждения</div>
        <div style="margin-top: 20px;">
          <button type="button" class="duel-btn duel-btn-cancel" id="duel-waiting-cancel">Отменить вызов</button>
        </div>
      </div>
    `;

    const cancelBtn = this.waitingModalEl.querySelector('#duel-waiting-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.cancelWaiting());

    this.waitingModalEl.hidden = false;
  }

  cancelWaiting(): void {
    if (this.waitingTargetOpponentId) {
      this.callbacks.onCancelInvite?.(this.waitingTargetOpponentId);
      this.waitingTargetOpponentId = null;
    }
    if (this.waitingModalEl) {
      this.waitingModalEl.hidden = true;
    }
  }

  hideWaiting(): void {
    this.waitingTargetOpponentId = null;
    if (this.waitingModalEl) {
      this.waitingModalEl.hidden = true;
    }
  }

  showDeclinedNotice(reason = 'Вызов отклонён соперником'): void {
    this.waitingTargetOpponentId = null;
    if (!this.waitingModalEl) return;
    this.waitingModalEl.innerHTML = `
      <div class="duel-modal-card duel-card-small">
        <div class="duel-modal-title" style="font-size:20px; color:#ff6b6b">❌ Вызов отклонён</div>
        <div style="margin: 16px 0; font-size: 15px;">
          ${reason}
        </div>
      </div>
    `;
    this.waitingModalEl.hidden = false;
    window.setTimeout(() => {
      if (this.waitingModalEl) this.waitingModalEl.hidden = true;
    }, 2500);
  }

  // --- Incoming Invite ---

  showIncomingInvite(inviteId: string, challengerName: string, track: DuelTrackDef): void {
    this.hideAllModals();
    this.currentInviteId = inviteId;

    if (!this.inviteModalEl) return;

    playAudioBeep(580, 0.25, 'triangle');

    this.inviteModalEl.innerHTML = `
      <div class="duel-modal-card duel-card-small">
        <div class="duel-invite-header">⚡ ВЫЗОВ НА ГОНКУ!</div>
        <div style="font-size: 17px; margin: 12px 0;">
          <b style="color:#ffd23d">${challengerName}</b> бросает вам вызов!
        </div>
        <div class="duel-invite-track">
          <div style="font-size: 14px; opacity:0.8; margin-bottom: 4px;">Трасса:</div>
          <div style="font-size: 18px; font-weight:800; color:#ffd23d">${track.badge} ${track.name} (${track.distanceMeters} м)</div>
          <div style="font-size: 13px; opacity:0.85; margin-top: 4px;">${track.subtitle}</div>
        </div>
        <div class="duel-invite-actions">
          <button type="button" class="duel-btn duel-btn-accept" id="duel-invite-accept">
            <kbd>Y</kbd> Принять
          </button>
          <button type="button" class="duel-btn duel-btn-decline" id="duel-invite-decline">
            <kbd>N</kbd> Отклонить
          </button>
        </div>
      </div>
    `;

    const acceptBtn = this.inviteModalEl.querySelector('#duel-invite-accept');
    const declineBtn = this.inviteModalEl.querySelector('#duel-invite-decline');
    if (acceptBtn) acceptBtn.addEventListener('click', () => this.acceptCurrentInvite());
    if (declineBtn) declineBtn.addEventListener('click', () => this.declineCurrentInvite());

    this.inviteModalEl.hidden = false;

    // Auto-dismiss after 15s
    if (this.inviteTimer) window.clearTimeout(this.inviteTimer);
    this.inviteTimer = window.setTimeout(() => {
      this.declineCurrentInvite();
    }, 15000);
  }

  private acceptCurrentInvite(): void {
    if (this.inviteTimer) {
      window.clearTimeout(this.inviteTimer);
      this.inviteTimer = null;
    }
    const inviteId = this.currentInviteId;
    this.currentInviteId = null;
    if (this.inviteModalEl) {
      this.inviteModalEl.hidden = true;
    }
    if (inviteId) {
      this.callbacks.onAcceptInvite?.(inviteId);
    }
  }

  private declineCurrentInvite(): void {
    if (this.inviteTimer) {
      window.clearTimeout(this.inviteTimer);
      this.inviteTimer = null;
    }
    const inviteId = this.currentInviteId;
    this.currentInviteId = null;
    if (this.inviteModalEl) {
      this.inviteModalEl.hidden = true;
    }
    if (inviteId) {
      this.callbacks.onDeclineInvite?.(inviteId);
    }
  }

  hideIncomingInvite(): void {
    if (this.inviteTimer) {
      window.clearTimeout(this.inviteTimer);
      this.inviteTimer = null;
    }
    this.currentInviteId = null;
    if (this.inviteModalEl) {
      this.inviteModalEl.hidden = true;
    }
  }

  // --- Countdown Overlay ---

  startCountdown(seconds = 3, onGo?: () => void): void {
    this.hideAllModals();
    if (!this.countdownEl) return;

    if (this.countdownTimer) {
      window.clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }

    let remaining = seconds;
    this.countdownEl.hidden = false;

    const tick = () => {
      if (!this.countdownEl) return;
      if (remaining > 0) {
        this.countdownEl.innerHTML = `<div class="countdown-digit countdown-pulse">${remaining}</div>`;
        playAudioBeep(440, 0.15, 'triangle');
        remaining--;
      } else if (remaining === 0) {
        this.countdownEl.innerHTML = `<div class="countdown-digit countdown-go countdown-pulse">СТАРТ!</div>`;
        playAudioBeep(880, 0.35, 'square');
        remaining--;
        onGo?.();
        // Hide after 1s
        window.setTimeout(() => {
          if (this.countdownEl) this.countdownEl.hidden = true;
        }, 1000);
        if (this.countdownTimer) {
          window.clearInterval(this.countdownTimer);
          this.countdownTimer = null;
        }
      }
    };

    tick();
    this.countdownTimer = window.setInterval(tick, 1000);
  }

  // --- In-Race HUD ---

  showRaceHud(trackName: string): void {
    if (!this.raceHudEl) return;
    this.raceHudEl.innerHTML = `
      <div class="duel-race-card">
        <div class="duel-race-header">
          <span class="duel-race-track">${trackName}</span>
          <span class="duel-race-time" id="duel-race-clock">00:00.00</span>
        </div>
        <div class="duel-race-stats">
          <div class="duel-pos-badge" id="duel-pos-badge">1 МЕСТО</div>
          <div class="duel-cp-status" id="duel-cp-status">КП 0 / --</div>
          <div class="duel-gap-status" id="duel-gap-status">0 м</div>
        </div>
      </div>
    `;
    this.raceHudEl.hidden = false;
  }

  updateRaceHud(data: {
    position: 1 | 2;
    checkpointIndex: number;
    totalCheckpoints: number;
    gapMeters: number;
    elapsedMs: number;
  }): void {
    if (!this.raceHudEl || this.raceHudEl.hidden) return;

    const clock = this.raceHudEl.querySelector('#duel-race-clock');
    const pos = this.raceHudEl.querySelector('#duel-pos-badge');
    const cp = this.raceHudEl.querySelector('#duel-cp-status');
    const gap = this.raceHudEl.querySelector('#duel-gap-status');

    if (clock) clock.textContent = formatRaceTime(data.elapsedMs);
    if (pos) {
      pos.textContent = `${data.position} МЕСТО`;
      pos.className = `duel-pos-badge ${data.position === 1 ? 'pos-p1' : 'pos-p2'}`;
    }
    if (cp) {
      cp.textContent = `КП ${data.checkpointIndex} / ${data.totalCheckpoints}`;
    }
    if (gap) {
      const gapSign = data.position === 1 ? '+' : '-';
      const gapAbs = Math.abs(Math.round(data.gapMeters));
      gap.textContent = `${gapSign}${gapAbs} м`;
      gap.className = `duel-gap-status ${data.position === 1 ? 'gap-ahead' : 'gap-behind'}`;
    }
  }

  hideRaceHud(): void {
    if (this.raceHudEl) {
      this.raceHudEl.hidden = true;
    }
  }

  // --- Results Modal ---

  showResults(results: DuelResultDisplayData, onDismiss?: () => void): void {
    this.hideRaceHud();
    if (!this.resultModalEl) return;

    if (results.won) {
      playAudioBeep(880, 0.45, 'triangle');
    } else {
      playAudioBeep(330, 0.3, 'sine');
    }

    const title = results.forfeit
      ? (results.won ? '🏆 ТЕХНИЧЕСКАЯ ПОБЕДА!' : '🏳️ ПОРАЖЕНИЕ')
      : (results.won ? '🏆 ПОБЕДА В ДУЭЛИ!' : '🏁 ФИНИШ ДУЭЛИ');

    const winnerTimeStr = formatRaceTime(results.winnerTimeMs);
    const loserTimeStr = results.loserTimeMs ? formatRaceTime(results.loserTimeMs) : (results.forfeit ? 'Сход' : '--:--.--');
    const diffStr = (results.loserTimeMs && results.loserTimeMs > results.winnerTimeMs)
      ? `(+${((results.loserTimeMs - results.winnerTimeMs) / 1000).toFixed(2)} с)`
      : '';

    this.resultModalEl.innerHTML = `
      <div class="duel-modal-card">
        <div class="duel-result-title ${results.won ? 'result-win' : 'result-loss'}">${title}</div>
        <div class="duel-result-track">${results.trackName}</div>

        <div class="duel-leaderboard">
          <div class="duel-leaderboard-row p1-row">
            <span class="leaderboard-pos">🥇 1</span>
            <span class="leaderboard-name">${results.winnerName}</span>
            <span class="leaderboard-time">${winnerTimeStr}</span>
          </div>
          <div class="duel-leaderboard-row p2-row">
            <span class="leaderboard-pos">🥈 2</span>
            <span class="leaderboard-name">${results.loserName}</span>
            <span class="leaderboard-time">${loserTimeStr} <small style="opacity:0.7">${diffStr}</small></span>
          </div>
        </div>

        <div style="margin-top: 24px; text-align: center;">
          <button type="button" class="duel-btn duel-btn-accept" id="duel-result-dismiss">
            Продолжить гонку
          </button>
        </div>
      </div>
    `;

    const dismissBtn = this.resultModalEl.querySelector('#duel-result-dismiss');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        this.hideResultModal();
        onDismiss?.();
      });
    }

    this.resultModalEl.hidden = false;
  }

  hideResultModal(): void {
    if (this.resultModalEl) {
      this.resultModalEl.hidden = true;
    }
  }

  // --- Helpers ---

  hideAllModals(): void {
    this.hideProximityPrompt();
    this.closeTrackSelector();
    this.hideWaiting();
    this.hideIncomingInvite();
    this.hideResultModal();
  }

  isRacing(): boolean {
    return !!(this.raceHudEl && !this.raceHudEl.hidden);
  }

  isAnyModalOpen(): boolean {
    return !!(
      (this.trackModalEl && !this.trackModalEl.hidden) ||
      (this.waitingModalEl && !this.waitingModalEl.hidden) ||
      (this.inviteModalEl && !this.inviteModalEl.hidden) ||
      (this.resultModalEl && !this.resultModalEl.hidden)
    );
  }

  destroy(): void {
    if (this.countdownTimer) window.clearInterval(this.countdownTimer);
    if (this.inviteTimer) window.clearTimeout(this.inviteTimer);
    this.promptEl?.remove();
    this.trackModalEl?.remove();
    this.waitingModalEl?.remove();
    this.inviteModalEl?.remove();
    this.countdownEl?.remove();
    this.raceHudEl?.remove();
    this.resultModalEl?.remove();
  }
}
