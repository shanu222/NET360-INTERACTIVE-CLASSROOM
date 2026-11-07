import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client';

/**
 * Removes background noise (fans, traffic, keyboard, room hum) from the microphone
 * before it is sent, with RNNoise — a small neural network that runs in the browser.
 * The browser's own echo cancellation still runs first, so the other side's voice
 * coming out of a speaker is not sent back.
 */
export class NoiseFilter implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = 'rnnoise';
  processedTrack?: MediaStreamTrack;
  private nodes: AudioNode[] = [];

  async init({ track, audioContext: ctx }: AudioProcessorOptions) {
    const [{ RnnoiseWorkletNode, loadRnnoise }, worklet, wasm, simd] = await Promise.all([
      import('@sapphi-red/web-noise-suppressor'),
      import('@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'),
      import('@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'),
      import('@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'),
    ]);
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
    binary ??= loadRnnoise({ url: wasm.default, simdUrl: simd.default });
    if (!loaded.has(ctx)) loaded.set(ctx, ctx.audioWorklet.addModule(worklet.default));
    const [wasmBinary] = await Promise.all([binary, loaded.get(ctx)]);
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const denoise = new RnnoiseWorkletNode(ctx, { wasmBinary, maxChannels: 1 });
    // A gentle lift and limiter keep quiet and loud speakers at a similar level.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -24;
    comp.knee.value = 18;
    comp.ratio.value = 3;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    // Make up the level the filter takes off, so voices stay as loud as before.
    const lift = ctx.createGain();
    lift.gain.value = 1.5;
    const out = ctx.createMediaStreamDestination();
    out.channelCount = 1;
    source.connect(denoise).connect(lift).connect(comp).connect(out);
    this.nodes = [source, denoise, lift, comp];
    this.processedTrack = out.stream.getAudioTracks()[0];
  }

  async restart(opts: AudioProcessorOptions) {
    await this.destroy();
    await this.init(opts);
  }

  async destroy() {
    for (const n of this.nodes) n.disconnect();
    this.nodes = [];
    this.processedTrack?.stop();
    this.processedTrack = undefined;
  }
}

let binary: Promise<ArrayBuffer> | undefined;
const loaded = new WeakMap<AudioContext, Promise<void>>();
let shared: AudioContext | null = null;
/** One 48 kHz audio context for the filter (RNNoise works at 48 kHz). */
export function denoiseContext() {
  if (!shared || shared.state === 'closed') shared = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  return shared;
}

/** Whether this browser can run the noise filter. */
export const canDenoise = () => typeof AudioWorkletNode !== 'undefined' && typeof WebAssembly !== 'undefined';
