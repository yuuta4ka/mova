# Call test audio

`call-speech.wav` is six seconds of locally synthesized English test speech
(48 kHz, mono, PCM16), generated with macOS `say` and `afconvert`. It contains
no microphone recording or user audio.

Chromium loops it as its fake microphone in `pnpm test:call`. The default
Chromium test tone can be removed by RNNoise, which makes a successful voice
transmission test incorrectly fail. Override with `MOVA_TEST_AUDIO_FILE` to use
another local WAV. The test also sets a Web Audio gain to zero to verify the
no-signal warning and restores it to verify recovery.
