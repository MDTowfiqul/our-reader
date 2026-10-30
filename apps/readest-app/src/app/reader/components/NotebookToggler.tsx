import React from 'react';
import { RiQuillPenLine } from 'react-icons/ri';

import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useNotebookStore } from '@/store/notebookStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Button from '@/components/Button';

interface NotebookTogglerProps {
  bookKey: string;
}

/** Reader header button: opens the Notebook panel (Notes only). */
const NotebookToggler: React.FC<NotebookTogglerProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { setHoveredBookKey } = useReaderStore();
  const { sideBarBookKey, setSideBarBookKey } = useSidebarStore();
  const { isNotebookVisible, toggleNotebook, setNotebookActiveTab, setPanelMode, panelMode } =
    useNotebookStore();
  const iconSize18 = useResponsiveSize(18);

  const handleToggleSidebar = () => {
    if (appService?.isMobile) {
      setHoveredBookKey('');
    }
    // The panel is already open in the other mode (e.g. AI): switch modes
    // instead of closing it — the two buttons must never close each other.
    if (sideBarBookKey === bookKey && isNotebookVisible && panelMode !== 'notebook') {
      setPanelMode('notebook');
      setNotebookActiveTab('notes');
      return;
    }
    const willOpen = !(sideBarBookKey === bookKey && isNotebookVisible);
    if (willOpen) {
      setPanelMode('notebook');
      setNotebookActiveTab('notes');
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
      icon={<RiQuillPenLine size={iconSize18} className='text-base-content' />}
      onClick={handleToggleSidebar}
      label={_('Notebook')}
    ></Button>
  );
};

export default NotebookToggler;
