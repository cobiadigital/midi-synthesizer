export type EnvelopeStage = "idle" | "attack" | "decay" | "sustain" | "release";

/**
 * ADSR envelope with analog-style exponential curves.
 *
 * Each stage moves the level toward a target that deliberately overshoots
 * (attack aims slightly above 1, decay and release slightly below their
 * destinations) so the exponential actually arrives instead of asymptoting.
 * Times are in seconds. Output is 0..1.
 */
export class Envelope {
  stage: EnvelopeStage = "idle";
  level = 0;

  private attackCoef = 0;
  private decayCoef = 0;
  private releaseCoef = 0;
  private sustainLevel = 1;

  private static readonly ATTACK_TARGET = 1.3;
  private static readonly UNDERSHOOT = -0.02;

  constructor(private readonly sampleRate: number) {
    this.setAttack(0.005);
    this.setDecay(0.2);
    this.setSustain(1);
    this.setRelease(0.2);
  }

  setAttack(seconds: number): void {
    // The attack stops at 1.0 while aiming at ATTACK_TARGET, so it only runs
    // ln(TARGET / (TARGET - 1)) time constants. Scale so it lands on time.
    const constants = Math.log(Envelope.ATTACK_TARGET / (Envelope.ATTACK_TARGET - 1));
    this.attackCoef = this.coef(seconds, constants);
  }

  setDecay(seconds: number): void {
    this.decayCoef = this.coef(seconds);
  }

  setSustain(level: number): void {
    this.sustainLevel = Math.min(1, Math.max(0, level));
  }

  setRelease(seconds: number): void {
    this.releaseCoef = this.coef(seconds);
  }

  /** Start the attack. Does not reset the level, so legato retriggers are click-free. */
  trigger(): void {
    this.stage = "attack";
  }

  release(): void {
    if (this.stage !== "idle") this.stage = "release";
  }

  isActive(): boolean {
    return this.stage !== "idle";
  }

  process(): number {
    switch (this.stage) {
      case "idle":
        return 0;
      case "attack":
        this.level += (Envelope.ATTACK_TARGET - this.level) * this.attackCoef;
        if (this.level >= 1) {
          this.level = 1;
          this.stage = "decay";
        }
        break;
      case "decay":
        this.level += (this.sustainLevel + Envelope.UNDERSHOOT - this.level) * this.decayCoef;
        if (this.level <= this.sustainLevel) {
          this.level = this.sustainLevel;
          this.stage = "sustain";
        }
        break;
      case "sustain":
        this.level = this.sustainLevel;
        break;
      case "release":
        this.level += (Envelope.UNDERSHOOT - this.level) * this.releaseCoef;
        if (this.level <= 0) {
          this.level = 0;
          this.stage = "idle";
        }
        break;
    }
    return this.level;
  }

  /**
   * One-pole coefficient so that `timeConstants` time constants elapse in
   * `seconds`. The default 4.6 corresponds to 99% completion.
   */
  private coef(seconds: number, timeConstants = 4.6): number {
    const samples = Math.max(1, seconds * this.sampleRate);
    return 1 - Math.exp(-timeConstants / samples);
  }
}
