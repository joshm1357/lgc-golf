import { describe, it, expect, vi, afterEach } from 'vitest';
import { shareText } from './push.js';

const setup = ({ fine }) => {
  const share = vi.fn(async () => {});
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { share, clipboard: { writeText } });
  vi.stubGlobal('window', { matchMedia: (q) => ({ matches: q.includes('coarse') ? !fine : fine }) });
  return { share, writeText };
};
afterEach(() => vi.unstubAllGlobals());

describe('v10.5: share to the group chat', () => {
  it('on a computer: copies the message (no share window with Outlook)', async () => {
    const { share, writeText } = setup({ fine: true });
    expect(await shareText('hi', 'Trip')).toBe('copied');
    expect(share).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith('hi');
  });
  it('on a phone: the share sheet, as before', async () => {
    const { share, writeText } = setup({ fine: false });
    expect(await shareText('hi', 'Trip')).toBe('shared');
    expect(share).toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });
});
