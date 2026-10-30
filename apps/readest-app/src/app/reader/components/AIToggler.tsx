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

interface AITogglerProps {
  bookKey: string;
}

/** Reader header button: opens the AI panel (book chat + summary tabs).
    Separate from the Notebook panel — Notes are never reachable from here. */
const AIToggler: React.FC<AITogglerProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { setHoveredBookKey } = useReaderStore();
  const { sideBarBookKey, setSideBarBookKey } = useSidebarStore();
  const { isNotebookVisible, toggleNotebook, setNotebookActiveTab, setPanelMode, panelMode } =
    useNotebookStore();
  const { settings } = useSettingsStore();
  const aiEnabled = settings?.aiSettings?.enabled ?? false;
  const iconSize18 = useResponsiveSize(18);

  const handleToggleSidebar = () => {
    if (appService?.isMobile) {
      setHoveredBookKey('');
    }
    // The panel is already open in the other mode (e.g. Notebook): switch
    // modes instead of closing it.
    if (sideBarBookKey === bookKey && isNotebookVisible && panelMode !== 'ai') {
      setPanelMode('ai');
      setNotebookActiveTab(aiEnabled ? 'ai' : 'summary');
      return;
    }
    const willOpen = !(sideBarBookKey === bookKey && isNotebookVisible);
    // Opening from the reading page lands on the AI tab when AI is
    // enabled, otherwise on the Summary tab.
    if (willOpen) {
      setPanelMode('ai');
      setNotebookActiveTab(aiEnabled ? 'ai' : 'summary');
    }
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

export default AIToggler;
