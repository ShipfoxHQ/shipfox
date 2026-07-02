import {toast} from '@shipfox/react-ui';
import {copyKeyName} from './copy-key.js';

vi.mock('@shipfox/react-ui', () => ({
  toast: {success: vi.fn(), error: vi.fn()},
}));

describe('copyKeyName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('writes the bare key name to the clipboard and toasts success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {clipboard: {writeText}});

    await copyKeyName('MY_TOKEN');

    expect(writeText).toHaveBeenCalledExactlyOnceWith('MY_TOKEN');
    expect(toast.success).toHaveBeenCalledExactlyOnceWith('Copied MY_TOKEN');
    expect(toast.error).not.toHaveBeenCalled();
  });

  test('no-ops safely and warns when the clipboard API is unavailable', async () => {
    vi.stubGlobal('navigator', {});

    await copyKeyName('MY_TOKEN');

    expect(toast.error).toHaveBeenCalledOnce();
  });

  test('surfaces a toast when the clipboard write rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', {clipboard: {writeText}});

    await copyKeyName('MY_TOKEN');

    expect(toast.error).toHaveBeenCalledOnce();
  });
});
