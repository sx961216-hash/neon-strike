export class SoundSystem {
  constructor() {
    this.context = null;
    this.master = null;
    this.muted = false;
    this.musicTimer = null;
    this.musicStep = 0;
  }

  async unlock() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.28;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') await this.context.resume();
    return true;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.28, this.context.currentTime, 0.02);
    }
  }

  tone(frequency, duration, type = 'square', volume = 0.15, slide = 0) {
    if (!this.context || !this.master || this.muted) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (slide) oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, frequency + slide), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  noise(duration = 0.12, volume = 0.2) {
    if (!this.context || !this.master || this.muted) return;
    const length = Math.floor(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1300;
    gain.gain.setValueAtTime(volume, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.context.currentTime + duration);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start();
  }

  play(name) {
    if (!this.context || this.muted) return;
    const sounds = {
      shoot: () => this.tone(520, 0.06, 'square', 0.08, -260),
      enemyShoot: () => this.tone(180, 0.08, 'sawtooth', 0.06, -80),
      jump: () => this.tone(260, 0.12, 'triangle', 0.12, 240),
      hit: () => this.tone(110, 0.08, 'sawtooth', 0.11, -40),
      pickup: () => this.tone(720, 0.16, 'sine', 0.14, 420),
      explode: () => this.noise(0.32, 0.28),
      dash: () => this.tone(170, 0.18, 'sawtooth', 0.08, 320),
      boss: () => this.tone(70, 0.55, 'sawtooth', 0.18, 20),
      victory: () => {
        this.tone(392, 0.2, 'square', 0.12, 0);
        setTimeout(() => this.tone(523, 0.2, 'square', 0.12, 0), 150);
        setTimeout(() => this.tone(659, 0.35, 'square', 0.12, 0), 300);
      }
    };
    sounds[name]?.();
  }

  startMusic() {
    if (!this.context || this.musicTimer) return;
    const bass = [55, 55, 65, 55, 73, 65, 49, 55];
    const lead = [220, 262, 330, 262, 392, 330, 294, 262];
    this.musicStep = 0;
    this.musicTimer = setInterval(() => {
      if (this.muted) return;
      const step = this.musicStep % 8;
      this.tone(bass[step], 0.16, 'sawtooth', 0.035, 0);
      if (step % 2 === 0) this.tone(lead[step], 0.11, 'square', 0.022, 0);
      this.musicStep += 1;
    }, 180);
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
}