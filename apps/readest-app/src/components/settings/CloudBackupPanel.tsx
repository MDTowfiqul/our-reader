import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import GoogleDriveForm from './integrations/GoogleDriveForm';
import TelegramBackupForm from './integrations/TelegramBackupForm';
import { SectionTitle, Tips } from './primitives';

/**
 * Cloud Backup — replaces the old Integrations panel. Only two backup
 * destinations remain: Google Drive (live library sync) and Telegram
 * Backup (a backup zip sent to the user's own Telegram chat/channel).
 * Everything else that lived under Integrations (KOReader, Readwise,
 * Hardcover, OPDS, Send to Readest, WebDAV, S3, OneDrive, iCloud,
 * Readest Cloud, Discord, LocalSend) is gone from this panel;
 * IntegrationsPanel.tsx is left in place, unused, for a later cleanup.
 */
const CloudBackupPanel: React.FC = () => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();

  return (
    <div className='my-4 w-full space-y-6'>
      <div className='w-full px-4'>
        <h2 className='mb-1.5 text-lg font-semibold tracking-tight'>{_('Cloud Backup')}</h2>
        <p className='text-base-content/70 text-sm leading-relaxed'>
          {_(
            'Back up your library to the cloud. Google Drive syncs your books, progress and notes. Telegram Backup sends a backup file to your Telegram chat or channel.',
          )}
        </p>
      </div>

      <div className='w-full' data-setting-id='settings.cloudbackup.gdrive'>
        <SectionTitle className='mb-2'>{_('Google Drive')}</SectionTitle>
        <GoogleDriveForm />
        {settings.googleDrive?.enabled && (
          <div className='mt-5'>
            <Tips>
              <li>
                {_('{{provider}} keeps a full copy of your books, progress, and annotations.', {
                  provider: _('Google Drive'),
                })}
              </li>
              <li>
                {_(
                  'App settings, reading statistics, and dictionaries still sync through your Our Reader account while signed in.',
                )}
              </li>
            </Tips>
          </div>
        )}
      </div>

      <div className='w-full' data-setting-id='settings.cloudbackup.telegram'>
        <SectionTitle className='mb-2'>{_('Telegram Backup')}</SectionTitle>
        <TelegramBackupForm />
      </div>
    </div>
  );
};

export default CloudBackupPanel;
