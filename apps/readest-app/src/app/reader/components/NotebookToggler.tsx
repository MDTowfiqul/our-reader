import React from 'react';
import { PiRobot } from 'react-icons/pi';

import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useNotebookStore } from '@/store/notebookStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Button from '@/components/Button';

interface NotebookTogglerProps {
  bookKey: string;
}

const NotebookToggler: React.FC<NotebookTogglerProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { setHoveredBookKey } = useReaderStore();
  const { sideBarBookKey, setSideBarBookKey } = useSidebarStore();
  const { isNotebookVisible, toggleNotebook, setNotebookActiveTab } = useNotebookStore();
  const { settings } = useSettingsStore();
  const aiEnabled = settings?.aiSettings?.enabled ?? false;
  const iconSize18 = useResponsiveSize(18);

  const handleToggleSidebar = () => {
    if (appService?.isMobile) {
      setHoveredBookKey('');
    }
    const willOpen = !(sideBarBookKey === bookKey && isNotebookVisible);
    // Opening from the reading page lands on the AI tab when AI is
    // enabled, otherwise on the Summary tab; Notes stay one tap away
    // inside the panel.
    if (willOpen) setNotebookActiveTab(aiEnabled ? 'ai' : 'summary');
    if (sideBarBookKey === bookKey) {
      toggleNotebook();
    } else {
      setSideBarBookKey(bookKey);
      if (!isNotebookVisible) toggleNotebook();
    }
  };
  return (
    <Button
      icon={<PiRobot size={iconSize18} className='text-base-content' />}
      onClick={handleToggleSidebar}
      label={_('AI')}
    ></Button>
  );
};

export default NotebookToggler;
