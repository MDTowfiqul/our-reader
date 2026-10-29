import React from 'react';
import { WandSparkles } from 'lucide-react';

import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useNotebookStore } from '@/store/notebookStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Button from '@/components/Button';

interface SummaryTogglerProps {
  bookKey: string;
}

/** Reader header button: opens the Notebook straight on the Summary tab. */
const SummaryToggler: React.FC<SummaryTogglerProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { setHoveredBookKey } = useReaderStore();
  const { sideBarBookKey, setSideBarBookKey } = useSidebarStore();
  const { isNotebookVisible, toggleNotebook, setNotebookActiveTab, setNotebookVisible } =
    useNotebookStore();
  const iconSize18 = useResponsiveSize(18);

  const handleClick = () => {
    if (appService?.isMobile) {
      setHoveredBookKey('');
    }
    setNotebookActiveTab('summary');
    if (sideBarBookKey === bookKey) {
      if (!isNotebookVisible) toggleNotebook();
    } else {
      setSideBarBookKey(bookKey);
      setNotebookVisible(true);
    }
  };

  return (
    <Button
      icon={<WandSparkles size={iconSize18} className='text-base-content' />}
      onClick={handleClick}
      label={_('Summary')}
    ></Button>
  );
};

export default SummaryToggler;
