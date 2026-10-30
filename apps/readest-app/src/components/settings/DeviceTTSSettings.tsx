import React, { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { saveViewSettings } from '@/helpers/settings';
import { TTSUtils } from '@/services/tts/TTSUtils';
import { BoxedList, SettingsRow, SettingsSelect } from './primitives';

// Speed range matches the Read Aloud speed ruler (SpeedRuler.tsx).
const SPEED_MIN = 0.5;
const SPEED_MAX = 3.0;
const SPEED_STEP = 0.05;

// Settings for the device speech engine (Google Device TTS in the voice
// picker, backed by window.speechSynthesis). The voice list is re-read
// fresh on mount and on every voiceschanged event: Chrome on Android often
// delivers voices only after the first call, so a list cached at first read
// can stay empty forever. Voice choice is stored per language with the
// same TTSUtils preference the reader's voice picker uses, so a choice made
// here is the voice books in that language play with.
const DEVICE_TTS_ENGINE = 'web-speech';
const PITCH_MIN = 0;
const PITCH_MAX = 2;
const PITCH_STEP = 0.1;

const voiceIdOf = (voice: SpeechSynthesisVoice): string => voice.voiceURI || voice.name;

const DeviceTTSSettings: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { getViewSettings } = useReaderStore();
  const { settings } = useSettingsStore();
  const viewSettings = getViewSettings(bookKey) || settings.globalViewSettings;

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [, setVoiceTick] = useState(0);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [ttsRate, setTtsRate] = useState(viewSettings.ttsRate ?? 1.3);
  const [ttsPitch, setTtsPitch] = useState(viewSettings.ttsPitch ?? 1.0);

  useEffect(() => {
    const synth = typeof window === 'undefined' ? undefined : window.speechSynthesis;
    if (!synth) {
      setSpeechSupported(false);
      return;
    }
    const refresh = () => setVoices([...synth.getVoices()]);
    refresh();
    synth.addEventListener('voiceschanged', refresh);
    return () => synth.removeEventListener('voiceschanged', refresh);
  }, []);

  const handleLoadVoices = () => {
    const synth = typeof window === 'undefined' ? undefined : window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
    // Same nudge as the reader's device client: some phones only report
    // their voices after the engine is used once. Silent, cancelled as
    // soon as voices arrive; the voiceschanged listener above re-reads.
    try {
      const utterance = new SpeechSynthesisUtterance(' ');
      utterance.volume = 0;
      const stop = () => {
        try {
          synth.cancel();
        } catch {
          // Engine absent mid-load; nothing to cancel.
        }
        setVoices([...synth.getVoices()]);
      };
      synth.addEventListener('voiceschanged', stop, { once: true });
      synth.speak(utterance);
      setTimeout(stop, 1500);
    } catch {
      // No speech engine; the empty note stands.
    }
  };

  useEffect(() => {
    if (ttsRate === viewSettings.ttsRate) return;
    saveViewSettings(envConfig, bookKey, 'ttsRate', ttsRate, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsRate]);

  useEffect(() => {
    if (ttsPitch === viewSettings.ttsPitch) return;
    saveViewSettings(envConfig, bookKey, 'ttsPitch', ttsPitch, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsPitch]);

  // The stored preference is per language: the selected option is the voice
  // whose id matches the preference stored for its own language.
  const selectedVoice = voices.find(
    (v) => TTSUtils.getPreferredVoice(DEVICE_TTS_ENGINE, v.lang) === voiceIdOf(v),
  );
  const selectedVoiceId = selectedVoice ? voiceIdOf(selectedVoice) : '';

  const handleVoiceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const voice = voices.find((v) => voiceIdOf(v) === e.target.value);
    if (!voice) return;
    TTSUtils.setPreferredVoice(DEVICE_TTS_ENGINE, voice.lang, voiceIdOf(voice));
    // The stored preference changed outside React state; re-render so the
    // select shows the new choice.
    setVoiceTick((t) => t + 1);
  };

  return (
    <BoxedList
      title={_('Google Device TTS')}
      cardClassName='overflow-hidden'
      data-setting-id='settings.tts.device'
    >
      <SettingsRow label={_('Voice')} data-setting-id='settings.tts.deviceVoice'>
        {!speechSupported || voices.length === 0 ? (
          <div className='pe-4'>
            <p className='text-base-content/65 text-sm leading-relaxed'>
              {_(
                'No device voices found. On Android, install voice data in Settings → System → Text-to-speech output → Google Text-to-Speech → Install voice data.',
              )}
            </p>
            {speechSupported && (
              <button
                type='button'
                className='btn btn-contrast btn-sm eink-bordered mt-2'
                onClick={handleLoadVoices}
              >
                {_('Load device voices')}
              </button>
            )}
          </div>
        ) : (
          <SettingsSelect
            value={selectedVoiceId}
            onChange={handleVoiceChange}
            ariaLabel={_('Device voice')}
            options={[
              { value: '', label: _('System default') },
              ...voices.map((v) => ({
                value: voiceIdOf(v),
                label: `${v.name} (${v.lang})`,
              })),
            ]}
          />
        )}
      </SettingsRow>
      <SettingsRow label={_('Speed')} data-setting-id='settings.tts.deviceSpeed'>
        <div className='flex items-center gap-2'>
          <input
            type='range'
            className='range range-sm eink-bordered'
            min={SPEED_MIN}
            max={SPEED_MAX}
            step={SPEED_STEP}
            value={ttsRate}
            aria-label={_('Device speech speed')}
            onChange={(e) => setTtsRate(Number(e.target.value))}
            data-setting-id='settings.tts.deviceSpeed'
          />
          <span className='text-base-content/70 w-14 text-end text-sm tabular-nums'>
            {`${ttsRate.toFixed(2)}×`}
          </span>
        </div>
      </SettingsRow>
      <SettingsRow label={_('Pitch')} data-setting-id='settings.tts.devicePitch'>
        <div className='flex items-center gap-2'>
          <input
            type='range'
            className='range range-sm eink-bordered'
            min={PITCH_MIN}
            max={PITCH_MAX}
            step={PITCH_STEP}
            value={ttsPitch}
            aria-label={_('Device speech pitch')}
            onChange={(e) => setTtsPitch(Number(e.target.value))}
            data-setting-id='settings.tts.devicePitch'
          />
          <span className='text-base-content/70 w-14 text-end text-sm tabular-nums'>
            {ttsPitch.toFixed(1)}
          </span>
        </div>
      </SettingsRow>
    </BoxedList>
  );
};

export default DeviceTTSSettings;
