import React, { useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { createBackupZip } from '@/services/backupService';
import { getAIFetch } from '@/services/ai/utils/httpFetch';
import { eventDispatcher } from '@/utils/event';
import type { TelegramBackupSettings } from '@/types/settings';
import { BoxedList, SettingLabel, SettingsSwitchRow, Tips } from './primitives';

const DEFAULT_TELEGRAM_BACKUP: TelegramBackupSettings = {
  enabled: false,
  botToken: '',
  chatId: '',
};

/**
 * Telegram Backup — sends a backup zip of the library to the user's own
 * Telegram chat or channel (Settings → Cloud Backup). The user creates a
 * bot with @BotFather, adds it to the chat/channel, and pastes the token
 * and chat ID here. The token is only ever sent to api.telegram.org, and
 * is stripped from backup zips (see BACKUP_SETTINGS_CREDENTIAL_FIELDS).
 * Restore stays file-based: download the zip from Telegram, then use
 * Backup & Restore in Advanced Settings.
 */
const TelegramBackupForm: React.FC = () => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();

  const stored: TelegramBackupSettings = settings.telegramBackup ?? DEFAULT_TELEGRAM_BACKUP;
  const [botToken, setBotToken] = useState(stored.botToken);
  const [chatId, setChatId] = useState(stored.chatId);
  const [isBusy, setIsBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const persist = async (patch: Partial<TelegramBackupSettings>) => {
    const latest = useSettingsStore.getState().settings;
    const next = {
      ...latest,
      telegramBackup: { ...(latest.telegramBackup ?? DEFAULT_TELEGRAM_BACKUP), ...patch },
    };
    setSettings(next);
    await saveSettings(envConfig, next);
  };

  const saveCredentials = async () => {
    await persist({ botToken: botToken.trim(), chatId: chatId.trim() });
  };

  const telegramApi = (token: string, method: string) =>
    `https://api.telegram.org/bot${token}/${method}`;

  const handleTestConnection = async () => {
    const token = botToken.trim();
    if (!token) {
      setError(_('Enter a bot token first.'));
      return;
    }
    setIsBusy(true);
    setError('');
    setStatus('');
    try {
      await saveCredentials();
      const response = await getAIFetch()(telegramApi(token, 'getMe'));
      const json = (await response.json()) as {
        ok?: boolean;
        result?: { username?: string; first_name?: string };
        description?: string;
      };
      if (!response.ok || !json.ok) {
        throw new Error(json.description || `Telegram error: ${response.status}`);
      }
      const name = json.result?.username
        ? `@${json.result.username}`
        : (json.result?.first_name ?? _('your bot'));
      setStatus(_('Connected to {{name}}', { name }));
    } catch (e) {
      setError((e as Error).message || _('Connection failed'));
    } finally {
      setIsBusy(false);
    }
  };

  const handleBackupNow = async () => {
    const token = botToken.trim();
    const targetChatId = chatId.trim();
    if (!token || !targetChatId) {
      setError(_('Enter a bot token and a chat ID first.'));
      return;
    }
    if (!appService) {
      setError(_('Backup is not available right now.'));
      return;
    }
    setIsBusy(true);
    setError('');
    setStatus(_('Creating backup…'));
    try {
      await saveCredentials();
      const zipData = await createBackupZip(appService);
      const date = new Date().toISOString().slice(0, 10);
      const filename = `our-reader-backup-${date}.zip`;
      const form = new FormData();
      form.append('chat_id', targetChatId);
      form.append('document', new Blob([zipData], { type: 'application/zip' }), filename);
      form.append('caption', `Our Reader backup ${date}`);
      setStatus(_('Sending to Telegram…'));
      const response = await getAIFetch()(telegramApi(token, 'sendDocument'), {
        method: 'POST',
        body: form,
      });
      const json = (await response.json()) as {
        ok?: boolean;
        result?: { message_id?: number };
        description?: string;
      };
      if (!response.ok || !json.ok) {
        throw new Error(json.description || `Telegram error: ${response.status}`);
      }
      await persist({ lastBackupAt: Date.now(), lastBackupMessageId: json.result?.message_id });
      setStatus(_('Backup sent to Telegram.'));
      eventDispatcher.dispatch('toast', { type: 'info', message: _('Backup sent to Telegram') });
    } catch (e) {
      setError((e as Error).message || _('Backup failed'));
      setStatus('');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className='space-y-5'>
      <BoxedList
        title={_('Telegram Backup')}
        description={_(
          'Create a bot with @BotFather, add it to your chat or channel, then paste its token and the chat ID. Back up now sends the backup zip to that chat.',
        )}
      >
        <SettingsSwitchRow
          label={_('Enable Telegram Backup')}
          checked={stored.enabled}
          onChange={() => void persist({ enabled: !stored.enabled })}
        />
        <div className='flex flex-col gap-2 py-3 pe-4'>
          <SettingLabel>{_('Bot Token')}</SettingLabel>
          <input
            type='password'
            className='input input-sm eink-bordered w-full'
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            onBlur={() => void saveCredentials()}
            placeholder='123456789:ABC…'
            autoComplete='off'
          />
        </div>
        <div className='flex flex-col gap-2 py-3 pe-4'>
          <SettingLabel>{_('Chat ID')}</SettingLabel>
          <input
            type='text'
            className='input input-sm eink-bordered w-full'
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            onBlur={() => void saveCredentials()}
            placeholder='-1001234567890'
            autoComplete='off'
          />
          <span className='text-base-content/60 text-xs'>
            {_('A group/channel ID (starts with -100) or @channel username.')}
          </span>
        </div>
        <div className='flex flex-wrap items-center gap-2 py-3 pe-4'>
          <button
            type='button'
            className='btn btn-contrast btn-sm'
            onClick={() => void handleBackupNow()}
            disabled={isBusy || !stored.enabled}
          >
            {_('Back up now')}
          </button>
          <button
            type='button'
            className='btn btn-outline btn-sm'
            onClick={() => void handleTestConnection()}
            disabled={isBusy}
          >
            {_('Test connection')}
          </button>
          {stored.lastBackupAt ? (
            <span className='text-base-content/60 text-xs'>
              {_('Last backup: {{time}}', {
                time: new Date(stored.lastBackupAt).toLocaleString(),
              })}
            </span>
          ) : null}
        </div>
        {status && <p className='text-success px-4 pb-3 text-sm'>{status}</p>}
        {error && <p className='text-error px-4 pb-3 text-sm'>{error}</p>}
      </BoxedList>
      <Tips>
        <li>
          {_(
            'Restore: download the backup file from Telegram, then use Backup & Restore in Advanced Settings.',
          )}
        </li>
        <li>{_('The bot can only send to chats it has been added to.')}</li>
      </Tips>
    </div>
  );
};

export default TelegramBackupForm;
