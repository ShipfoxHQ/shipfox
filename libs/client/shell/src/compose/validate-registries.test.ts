import {validateNavigation, validateSettingsSections} from './validate-registries.js';

const duplicateNavigationMessage = /projects.*shipfox\.one.*acme\.two/u;
const missingNavigationMessage = /insights.*acme\.two.*\/insights/u;
const duplicateSettingsMessage = /members.*shipfox\.one.*acme\.two/u;
const missingSettingsMessage = /sso.*acme\.two.*\/workspaces\/\$wid\/settings\/sso/u;

describe('registry validation', () => {
  test('names the id and both features for a duplicate navigation entry', () => {
    expect(() =>
      validateNavigation(
        [
          {
            id: 'shipfox.one',
            navigation: [{id: 'projects', scope: 'workspace', label: 'Projects', to: '/projects'}],
          },
          {
            id: 'acme.two',
            navigation: [{id: 'projects', scope: 'workspace', label: 'Projects', to: '/projects'}],
          },
        ],
        ['/projects'],
      ),
    ).toThrow(duplicateNavigationMessage);
  });

  test('names the id, target, and feature for a missing navigation route', () => {
    expect(() =>
      validateNavigation(
        [
          {
            id: 'acme.two',
            navigation: [{id: 'insights', scope: 'workspace', label: 'Insights', to: '/insights'}],
          },
        ],
        [],
      ),
    ).toThrow(missingNavigationMessage);
  });

  test('normalizes navigation targets before checking route existence', () => {
    expect(() =>
      validateNavigation(
        [
          {
            id: 'acme.two',
            navigation: [{id: 'insights', scope: 'workspace', label: 'Insights', to: '/insights/'}],
          },
        ],
        ['/insights'],
      ),
    ).not.toThrow();
  });

  test('names the id and both features for a duplicate settings section', () => {
    expect(() =>
      validateSettingsSections(
        [
          {
            id: 'shipfox.one',
            settingsSections: [
              {id: 'members', pathSegment: 'members', label: 'Members', icon: 'userLine'},
            ],
          },
          {
            id: 'acme.two',
            settingsSections: [
              {id: 'members', pathSegment: 'members', label: 'Members', icon: 'userLine'},
            ],
          },
        ],
        ['/workspaces/$wid/settings/members'],
      ),
    ).toThrow(duplicateSettingsMessage);
  });

  test('names the id, expected path, and feature for a missing settings route', () => {
    expect(() =>
      validateSettingsSections(
        [
          {
            id: 'acme.two',
            settingsSections: [
              {id: 'sso', pathSegment: 'sso', label: 'Single sign-on', icon: 'userLine'},
            ],
          },
        ],
        [],
      ),
    ).toThrow(missingSettingsMessage);
  });
});
