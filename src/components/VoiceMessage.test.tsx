import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { normalizeVoiceMessageWaveform, VoiceMessage } from './VoiceMessage';

const voiceAttachment = {
  name: 'Голосовое сообщение.webm',
  type: 'audio/webm;codecs=opus',
  size: 2_048,
  url: '/uploads/voice.webm',
  durationMs: 12_400,
  waveform: [0.2, 0.6, 0.35, 0.8, 0.45, 1, 0.4, 0.7],
};

describe('voice message waveform', () => {
  it('uses the entire recording instead of truncating its active ending', () => {
    const waveform = normalizeVoiceMessageWaveform([
      ...Array(32).fill(0.12),
      ...Array(8).fill(0.92),
    ]);

    expect(waveform).toHaveLength(28);
    expect(waveform[0]).toBe(0.24);
    expect(waveform.at(-1)).toBe(1);
  });

  it('keeps silent recordings as short bars', () => {
    expect(normalizeVoiceMessageWaveform(Array(40).fill(0.12))).toEqual(Array(28).fill(0.24));
  });

  it('shows an unlistened dot and reports the first actual playback once', () => {
    const onListen = vi.fn();
    const { container, rerender } = render(<VoiceMessage attachment={voiceAttachment} unlistened onListen={onListen} />);

    expect(screen.getByRole('img', { name: 'Голосовое сообщение ещё не прослушано' })).toBeVisible();
    const audio = container.querySelector('audio')!;
    fireEvent.play(audio);
    fireEvent.play(audio);
    expect(onListen).toHaveBeenCalledOnce();

    rerender(<VoiceMessage attachment={voiceAttachment} unlistened={false} onListen={onListen} />);
    expect(screen.queryByRole('img', { name: 'Голосовое сообщение ещё не прослушано' })).not.toBeInTheDocument();
  });

  it('primes an unloaded mobile audio element on the first play tap', () => {
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const { container } = render(<VoiceMessage attachment={voiceAttachment} />);

    expect(container.querySelector('audio')).toHaveAttribute('preload', 'auto');
    fireEvent.click(screen.getByRole('button', { name: 'Воспроизвести голосовое сообщение' }));

    expect(load).toHaveBeenCalledOnce();
    expect(play).toHaveBeenCalledOnce();
  });
});
