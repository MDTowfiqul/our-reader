'use client';

import React, { useCallback, useEffect, useState } from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useEnv } from '@/context/EnvContext';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import type { AISettings } from '@/services/ai/types';

/**
 * Custom instruction, moved out of Settings → AI into the AI panel so
 * Settings stays providers-only. The same settings field as before, so a
 * value saved from Settings carries over; it is added to every AI summary
 * and book-chat reply by the shared chat route.
 */
const CustomInstructionField: React.FC = () => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const aiSettings: AISettings = settings?.aiSettings ?? DEFAULT_AI_SETTINGS;

  const [value, setValue] = useState(aiSettings.customSystemPrompt ?? '');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setValue(aiSettings.customSystemPrompt ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.aiSettings?.customSystemPrompt]);

  const save = useCallback(
    async (next: string) => {
      if (!settings) return;
      const newSettings = {
        ...settings,
        aiSettings: { ...aiSettings, customSystemPrompt: next },
      };
      setSettings(newSettings);
      await saveSettings(envConfig, newSettings);
    },
    [settings, aiSettings, envConfig, setSettings, saveSettings],
  );

  return (
    <div className='border-base-300/50 border-t px-4 py-2'>
      <button
        type='button'
        className='text-muted-foreground text-xs font-medium'
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? _('Hide custom instruction') : _('Custom instruction')}
      </button>
      {open && (
        <div className='mt-2 flex flex-col gap-2'>
          <textarea
            className='textarea textarea-sm eink-bordered w-full'
            rows={3}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => void save(value)}
            placeholder={_('Optional custom instruction for the AI…')}
          />
          <div className='flex justify-end'>
            <button
              type='button'
              className='btn btn-ghost btn-sm eink-bordered'
              onClick={() => {
                setValue('');
                void save('');
              }}
              disabled={!value}
            >
              {_('Reset to default')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomInstructionField;
