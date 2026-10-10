import {resolveSourceAppDirectory} from './source-app.js';

describe('resolveSourceAppDirectory', () => {
  test('names the missing app and image mode when the app is not installed', () => {
    const resolveMissing = () => resolveSourceAppDirectory('@shipfox/not-installed');

    expect(resolveMissing).toThrow(
      "Source mode needs @shipfox/not-installed, which is not installed. Inside the Shipfox repository, add it to the package.json of the suite. Anywhere else, start capacity with mode: 'image'.",
    );
  });
});
