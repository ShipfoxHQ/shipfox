import {expect, test} from './test.js';

test.describe('workspace settings routing', () => {
  test('routes workspace settings to members by default', async ({
    auth,
    membersSettings,
    page,
    projects,
    workspaces,
  }) => {
    const user = await auth.createUser();
    const workspace = await workspaces.create({userId: user.user.id, name: 'Settings Workspace'});
    await projects.createProject({workspaceId: workspace.id});
    await auth.loginAs(page, user);

    await membersSettings.gotoDefault(workspace.slug);

    await expect(page).toHaveURL(new RegExp(`/w/${workspace.slug}/settings/members/?$`, 'u'));
    await expect(membersSettings.heading()).toBeVisible();
  });

  test('keeps setup workspace settings on members settings', async ({
    auth,
    membersSettings,
    page,
    workspaceHome,
    workspaces,
  }) => {
    const user = await auth.createUser();
    const workspace = await workspaces.create({
      userId: user.user.id,
      name: 'Setup Settings Workspace',
    });
    await auth.loginAs(page, user);

    await workspaceHome.gotoSettings(workspace.slug);

    await expect(page).toHaveURL(new RegExp(`/w/${workspace.slug}/settings/members/?$`, 'u'));
    await expect(membersSettings.heading()).toBeVisible();
  });

  test('settings tab opens members settings', async ({
    auth,
    membersSettings,
    page,
    projects,
    workspaceHome,
    workspaces,
  }) => {
    const user = await auth.createUser();
    const workspace = await workspaces.create({
      userId: user.user.id,
      name: 'Settings Tab Workspace',
    });
    await projects.createProject({workspaceId: workspace.id});
    await auth.loginAs(page, user);

    await workspaceHome.goto(workspace.slug);
    await workspaceHome.settingsTab().click();

    await expect(page).toHaveURL(new RegExp(`/w/${workspace.slug}/settings/members/?$`, 'u'));
    await expect(membersSettings.heading()).toBeVisible();
  });
});
