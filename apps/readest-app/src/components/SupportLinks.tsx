import { FaGithub } from 'react-icons/fa';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Link from './Link';

// Our Reader fork: only the fork's own repository is linked. Readest's
// Discord and Reddit communities are not ours, so they are not shown.
const SupportLinks = () => {
  const _ = useTranslation();
  const iconSize = useResponsiveSize(24);

  return (
    <div className='my-2 flex flex-col items-center gap-2'>
      <p className='text-neutral-content text-sm'>{_('Get Help from the Our Reader Community')}</p>
      <div className='flex gap-4'>
        <Link
          href='https://github.com/MDTowfiqul/our-reader'
          className='flex items-center gap-2 rounded-full bg-gray-800 p-1.5 text-white transition-colors hover:bg-gray-700'
          title='GitHub'
          aria-label='GitHub'
        >
          <FaGithub size={iconSize} />
        </Link>
      </div>
    </div>
  );
};

export default SupportLinks;
